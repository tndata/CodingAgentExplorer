namespace CodingAgentExplorer.Models;

public class ProxiedRequest
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..12];
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;

    // Request
    public string Method { get; set; } = "";
    public string Path { get; set; } = "";
    public Dictionary<string, string> RequestHeaders { get; set; } = [];
    public string? RequestBody { get; set; }

    // Parsed request fields
    public string? Model { get; set; }
    public bool IsStreaming { get; set; }
    public int? MaxTokens { get; set; }

    // Response
    public int? StatusCode { get; set; }
    public Dictionary<string, string> ResponseHeaders { get; set; } = [];
    public string? ResponseBody { get; set; }

    // Parsed response fields
    public string? MessageId { get; set; }
    public string? StopReason { get; set; }
    public int? InputTokens { get; set; }
    public int? OutputTokens { get; set; }
    public int? CacheCreationInputTokens { get; set; }
    public int? CacheReadInputTokens { get; set; }

    // SSE events (for streaming)
    public List<SseEvent> SseEvents { get; set; } = [];

    // Timing
    public double? DurationMs { get; set; }
    public double? TimeToFirstTokenMs { get; set; }
}
