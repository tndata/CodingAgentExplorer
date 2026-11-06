using CodingAgentExplorer.Services;

namespace CodingAgentExplorer.Tests;

public class ApiUpstreamTests
{
    [Theory]
    [InlineData("https://api.anthropic.com", "https://api.anthropic.com")]
    [InlineData("https://api.anthropic.com/", "https://api.anthropic.com")]
    [InlineData("  http://localhost:1234  ", "http://localhost:1234")]
    [InlineData("http://127.0.0.1:1234/", "http://127.0.0.1:1234")]
    [InlineData("https://gateway.example.com/anthropic/", "https://gateway.example.com/anthropic")]
    public void Valid_urls_are_normalised(string input, string expected)
    {
        Assert.True(ApiUpstreamConfig.TryNormalize(input, out var normalized, out _));
        Assert.Equal(expected, normalized);
    }

    [Theory]
    [InlineData("localhost:1234")]
    [InlineData("not a url")]
    [InlineData("ftp://example.com")]
    [InlineData("file:///c:/temp")]
    [InlineData("https://user:secret@example.com")]
    [InlineData("https://example.com/?x=1")]
    [InlineData("https://example.com/#top")]
    public void Invalid_urls_are_rejected(string input)
    {
        Assert.False(ApiUpstreamConfig.TryNormalize(input, out _, out var error));
        Assert.False(string.IsNullOrEmpty(error));
    }

    [Fact]
    public void Split_keeps_the_path_as_prefix()
    {
        Assert.Equal(("https://gateway.example.com", "/anthropic"),
            ApiUpstreamConfig.Split("https://gateway.example.com/anthropic"));
        Assert.Equal(("http://localhost:1234", ""),
            ApiUpstreamConfig.Split("http://localhost:1234"));
    }

    [Fact]
    public void Startup_order_is_environment_then_appsettings_then_default()
    {
        Assert.Equal(("http://localhost:1234", "environment variable"),
            ApiUpstreamConfig.ResolveStartup("http://localhost:1234", "https://other.example.com"));
        Assert.Equal(("https://other.example.com", "appsettings.json"),
            ApiUpstreamConfig.ResolveStartup(null, "https://other.example.com"));
        Assert.Equal((ApiUpstreamConfig.DefaultUrl, "default"),
            ApiUpstreamConfig.ResolveStartup("  ", null));
    }

    [Fact]
    public void Invalid_startup_value_fails_instead_of_falling_back()
    {
        var ex = Assert.Throws<InvalidOperationException>(() => ApiUpstreamConfig.ResolveStartup("localhost:1234", null));
        Assert.Contains(ApiUpstreamConfig.EnvironmentVariable, ex.Message);
    }

    [Fact]
    public void Override_is_active_until_reset()
    {
        var config = new ApiUpstreamConfig(null, null);
        Assert.Equal(ApiUpstreamConfig.DefaultUrl, config.ActiveUrl);

        Assert.True(config.TrySetOverride("http://localhost:1234/", out _));
        Assert.Equal("http://localhost:1234", config.ActiveUrl);
        Assert.Equal("Settings page", config.ActiveSource);

        Assert.True(config.TrySetOverride(null, out _));
        Assert.Equal(ApiUpstreamConfig.DefaultUrl, config.ActiveUrl);
        Assert.Equal("default", config.ActiveSource);
    }

    [Fact]
    public void Invalid_override_is_rejected_and_changes_nothing()
    {
        var config = new ApiUpstreamConfig(null, null);
        var token = config.GetChangeToken();

        Assert.False(config.TrySetOverride("localhost:1234", out var error));
        Assert.NotNull(error);
        Assert.Equal(ApiUpstreamConfig.DefaultUrl, config.ActiveUrl);
        Assert.False(token.HasChanged);
    }

    [Fact]
    public void A_valid_change_signals_yarp()
    {
        var config = new ApiUpstreamConfig(null, null);
        var token = config.GetChangeToken();
        Assert.True(config.TrySetOverride("http://localhost:1234", out _));
        Assert.True(token.HasChanged);
    }
}

public class DashboardRequestGuardTests
{
    [Theory]
    [InlineData("localhost", null)]
    [InlineData("127.0.0.1", "")]
    [InlineData("[::1]", null)]
    [InlineData("localhost", "http://localhost:5000")]
    [InlineData("localhost", "https://localhost:5001")]
    [InlineData("127.0.0.1", "http://127.0.0.1:5000")]
    public void Dashboard_and_local_tools_are_allowed(string host, string? origin)
        => Assert.True(DashboardRequestGuard.IsAllowed(host, origin));

    [Theory]
    [InlineData("evil.example.com", null)]               // DNS rebinding: foreign host name pointing at 127.0.0.1
    [InlineData("evil.example.com", "http://evil.example.com:5000")]
    [InlineData("localhost", "https://evil.example.com")] // another web site
    [InlineData("localhost", "http://localhost:3000")]   // another local web app
    [InlineData("localhost", "null")]                    // sandboxed iframe or file:// page
    [InlineData("", null)]
    public void Everything_else_is_refused(string host, string? origin)
        => Assert.False(DashboardRequestGuard.IsAllowed(host, origin));
}
