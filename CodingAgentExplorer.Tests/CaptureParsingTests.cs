using System.Diagnostics;
using CodingAgentExplorer.Models;
using CodingAgentExplorer.Proxy;
using Microsoft.AspNetCore.Http;

namespace CodingAgentExplorer.Tests;

public class CaptureParsingTests
{
    // Feeds (event, data) pairs through the same parser the proxy uses for each SSE event.
    private static ProxiedRequest Stream(params (string? Event, string Data)[] events)
    {
        var request = new ProxiedRequest();
        var stopwatch = Stopwatch.StartNew();
        var firstTokenSeen = false;
        foreach (var (evt, data) in events)
            CaptureTransformProvider.ParseSseEventData(request, evt, data, stopwatch, ref firstTokenSeen);
        return request;
    }

    private const string MessageStart =
        """{"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":2679,"cache_creation_input_tokens":100,"cache_read_input_tokens":500,"output_tokens":1}}}""";

    [Fact]
    public void MessageStart_sets_ids_and_input_side_usage()
    {
        var r = Stream(("message_start", MessageStart));

        Assert.Equal("msg_1", r.MessageId);
        Assert.Equal(2679, r.InputTokens);
        Assert.Equal(100, r.CacheCreationInputTokens);
        Assert.Equal(500, r.CacheReadInputTokens);
    }

    [Fact]
    public void MessageDelta_with_output_only_keeps_input_numbers_from_message_start()
    {
        var r = Stream(
            ("message_start", MessageStart),
            ("message_delta", """{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}"""));

        Assert.Equal(42, r.OutputTokens);
        Assert.Equal("end_turn", r.StopReason);
        Assert.Equal(2679, r.InputTokens);
        Assert.Equal(100, r.CacheCreationInputTokens);
        Assert.Equal(500, r.CacheReadInputTokens);
    }

    // G2: with server tools (web search) the cumulative usage in message_delta carries new input numbers.
    [Fact]
    public void MessageDelta_cumulative_usage_replaces_message_start_numbers()
    {
        var r = Stream(
            ("message_start", MessageStart),
            ("message_delta", """{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":10682,"cache_creation_input_tokens":100,"cache_read_input_tokens":900,"output_tokens":510,"server_tool_use":{"web_search_requests":1}}}"""));

        Assert.Equal(10682, r.InputTokens);
        Assert.Equal(900, r.CacheReadInputTokens);
        Assert.Equal(510, r.OutputTokens);
    }

    [Fact]
    public void Last_message_delta_wins_when_there_are_several()
    {
        var r = Stream(
            ("message_start", MessageStart),
            ("message_delta", """{"type":"message_delta","delta":{},"usage":{"input_tokens":5000,"output_tokens":10}}"""),
            ("message_delta", """{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":8000,"output_tokens":90}}"""));

        Assert.Equal(8000, r.InputTokens);
        Assert.Equal(90, r.OutputTokens);
    }

    [Fact]
    public void MessageDelta_with_null_usage_fields_does_not_overwrite()
    {
        var r = Stream(
            ("message_start", MessageStart),
            ("message_delta", """{"type":"message_delta","delta":{},"usage":{"input_tokens":null,"output_tokens":7}}"""));

        Assert.Equal(2679, r.InputTokens);
        Assert.Equal(7, r.OutputTokens);
    }

    // G6: an error event can arrive on a stream that already returned HTTP 200.
    [Fact]
    public void Error_event_sets_Error_with_type_and_message()
    {
        var r = Stream(
            ("message_start", MessageStart),
            ("error", """{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"""));

        Assert.NotNull(r.Error);
        Assert.Contains("overloaded_error", r.Error);
        Assert.Contains("Overloaded", r.Error);
    }

    [Fact]
    public void Error_event_without_message_still_names_the_type()
    {
        var r = Stream(("error", """{"type":"error","error":{"type":"api_error"}}"""));

        Assert.Contains("api_error", r.Error);
    }

    [Fact]
    public async Task First_content_block_delta_sets_time_to_first_token_once()
    {
        var request = new ProxiedRequest();
        var stopwatch = Stopwatch.StartNew();
        var seen = false;
        CaptureTransformProvider.ParseSseEventData(request, "content_block_delta", "{}", stopwatch, ref seen);
        var first = request.TimeToFirstTokenMs;
        await Task.Delay(20);
        CaptureTransformProvider.ParseSseEventData(request, "content_block_delta", "{}", stopwatch, ref seen);

        Assert.NotNull(first);
        Assert.Equal(first, request.TimeToFirstTokenMs);
    }

    [Theory]
    [InlineData("message_start", "not json")]
    [InlineData("message_delta", "")]
    [InlineData("error", "{}")]
    [InlineData("ping", """{"type":"ping"}""")]
    [InlineData("some_future_event", """{"type":"some_future_event","x":1}""")]
    [InlineData(null, """{"type":"message_start"}""")]
    public void Bad_or_unknown_events_are_ignored(string? evt, string data)
    {
        var r = Stream((evt, data));

        Assert.Null(r.InputTokens);
        Assert.Null(r.OutputTokens);
        Assert.Null(r.Error);
    }

    [Fact]
    public void DONE_marker_is_ignored()
    {
        var r = Stream(("message_delta", "[DONE]"));

        Assert.Null(r.OutputTokens);
    }

    [Fact]
    public void NonStreaming_response_reads_usage_and_ids()
    {
        var r = new ProxiedRequest();
        CaptureTransformProvider.ParseNonStreamingResponse(r,
            """{"id":"msg_2","model":"claude-test","stop_reason":"end_turn","usage":{"input_tokens":12,"output_tokens":34,"cache_creation_input_tokens":5,"cache_read_input_tokens":6}}""");

        Assert.Equal("msg_2", r.MessageId);
        Assert.Equal("claude-test", r.Model);
        Assert.Equal("end_turn", r.StopReason);
        Assert.Equal(12, r.InputTokens);
        Assert.Equal(34, r.OutputTokens);
        Assert.Equal(5, r.CacheCreationInputTokens);
        Assert.Equal(6, r.CacheReadInputTokens);
    }

    [Fact]
    public void NonStreaming_response_without_usage_leaves_numbers_empty()
    {
        // count_tokens returns {"input_tokens": N} without a usage object, and must not be counted as usage.
        var r = new ProxiedRequest();
        CaptureTransformProvider.ParseNonStreamingResponse(r, """{"input_tokens":123}""");

        Assert.Null(r.InputTokens);
    }

    [Fact]
    public void NonStreaming_response_that_is_not_json_is_ignored()
    {
        var r = new ProxiedRequest();
        CaptureTransformProvider.ParseNonStreamingResponse(r, "<html>502 Bad Gateway</html>");

        Assert.Null(r.MessageId);
    }

    [Fact]
    public void Credentials_are_redacted_in_request_headers_regardless_of_case()
    {
        var source = new HeaderDictionary
        {
            ["X-API-KEY"] = "test-secret-key",
            ["authorization"] = "Bearer test-secret-token",
            ["anthropic-version"] = "2023-06-01",
            ["x-claude-code-session-id"] = "abc",
        };
        var target = new Dictionary<string, string>();

        CaptureTransformProvider.CopyHeadersWithRedaction(source, target);

        Assert.Equal("[REDACTED]", target["X-API-KEY"]);
        Assert.Equal("[REDACTED]", target["authorization"]);
        Assert.Equal("2023-06-01", target["anthropic-version"]);
        Assert.Equal("abc", target["x-claude-code-session-id"]);
        Assert.DoesNotContain("test-secret", string.Concat(target.Values));
    }
}
