using Microsoft.Extensions.Primitives;

namespace CodingAgentExplorer.Services;

/// <summary>
/// Where the API proxy on port 8888 forwards requests (the "API upstream").
/// The startup value comes from the environment variable, then appsettings.json, then the default.
/// The Settings page can override it at runtime; clearing the override returns to the startup value.
/// The upstream must speak the Anthropic Messages API (for example api.anthropic.com, or LM Studio's
/// Anthropic-compatible endpoint). Nothing is translated.
/// </summary>
public sealed class ApiUpstreamConfig
{
    public const string DefaultUrl = "https://api.anthropic.com";
    public const string EnvironmentVariable = "CODING_AGENT_EXPLORER_UPSTREAM_URL";
    public const string ConfigKey = "ApiUpstream:Url";

    private readonly object _lock = new();
    private CancellationTokenSource _cts = new();
    private volatile string? _overrideUrl;

    public ApiUpstreamConfig(IConfiguration configuration)
        : this(Environment.GetEnvironmentVariable(EnvironmentVariable), configuration[ConfigKey])
    {
    }

    internal ApiUpstreamConfig(string? environmentValue, string? configValue)
    {
        (StartupUrl, StartupSource) = ResolveStartup(environmentValue, configValue);
    }

    /// <summary>The upstream chosen at startup (environment variable, appsettings.json or default).</summary>
    public string StartupUrl { get; }

    /// <summary>Where <see cref="StartupUrl"/> came from: "environment variable", "appsettings.json" or "default".</summary>
    public string StartupSource { get; }

    /// <summary>The value set on the Settings page, or null when none is set.</summary>
    public string? OverrideUrl => _overrideUrl;

    /// <summary>The upstream the proxy uses right now.</summary>
    public string ActiveUrl => _overrideUrl ?? StartupUrl;

    public string ActiveSource => _overrideUrl is null ? StartupSource : "Settings page";

    public IChangeToken GetChangeToken() => new CancellationChangeToken(_cts.Token);

    /// <summary>
    /// Sets or clears (null or empty) the runtime override. Returns false with an error message when the
    /// URL is not valid; the active upstream is then left unchanged.
    /// </summary>
    public bool TrySetOverride(string? url, out string? error)
    {
        string? normalized = null;
        if (!string.IsNullOrWhiteSpace(url) && !TryNormalize(url, out normalized, out error))
            return false;

        lock (_lock)
        {
            _overrideUrl = normalized;
            var old = _cts;
            _cts = new CancellationTokenSource();
            old.Cancel(); // signals YARP to call GetConfig() again
        }

        error = null;
        return true;
    }

    public object Describe() => new
    {
        activeUrl = ActiveUrl,
        activeSource = ActiveSource,
        startupUrl = StartupUrl,
        startupSource = StartupSource,
        overrideUrl = OverrideUrl,
        defaultUrl = DefaultUrl,
        environmentVariable = EnvironmentVariable,
    };

    /// <summary>
    /// Checks and normalises an upstream URL: absolute http or https, no user name or password,
    /// no query or fragment. A path is kept (without a trailing slash), for gateways under a path prefix.
    /// </summary>
    internal static bool TryNormalize(string input, out string normalized, out string error)
    {
        normalized = "";
        var text = input.Trim();

        if (!Uri.TryCreate(text, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            error = "Use an absolute http:// or https:// URL, for example http://localhost:1234";
            return false;
        }
        if (!string.IsNullOrEmpty(uri.UserInfo))
        {
            error = "The URL must not contain a user name or password";
            return false;
        }
        if (!string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
        {
            error = "The URL must not contain a query string or fragment";
            return false;
        }

        normalized = $"{uri.Scheme}://{uri.Authority}{uri.AbsolutePath.TrimEnd('/')}";
        error = "";
        return true;
    }

    /// <summary>Splits a normalised URL into the YARP destination ("https://host:port") and a path prefix ("" or "/prefix").</summary>
    internal static (string host, string pathPrefix) Split(string normalizedUrl)
    {
        var uri = new Uri(normalizedUrl);
        return ($"{uri.Scheme}://{uri.Authority}", uri.AbsolutePath.TrimEnd('/'));
    }

    internal static (string url, string source) ResolveStartup(string? environmentValue, string? configValue)
    {
        if (!string.IsNullOrWhiteSpace(environmentValue))
            return (NormalizeOrThrow(environmentValue, $"the environment variable {EnvironmentVariable}"), "environment variable");

        if (!string.IsNullOrWhiteSpace(configValue))
            return (NormalizeOrThrow(configValue, $"appsettings.json ({ConfigKey})"), "appsettings.json");

        return (DefaultUrl, "default");
    }

    private static string NormalizeOrThrow(string value, string where)
    {
        if (TryNormalize(value, out var normalized, out var error))
            return normalized;

        // Fail at startup rather than silently sending traffic somewhere else than the user asked for.
        throw new InvalidOperationException($"Invalid API upstream URL in {where}: '{value}'. {error}.");
    }
}
