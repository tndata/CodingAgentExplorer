using System.Text.Json.Serialization;

namespace CodingAgentExplorer.Models;

public class ClaudeRequestBody
{
    [JsonPropertyName("model")]
    public string? Model { get; set; }

    [JsonPropertyName("max_tokens")]
    public int? MaxTokens { get; set; }

    [JsonPropertyName("stream")]
    public bool? Stream { get; set; }

    [JsonPropertyName("system")]
    public object? System { get; set; }

    [JsonPropertyName("messages")]
    public List<ClaudeMessage>? Messages { get; set; }
}

public class ClaudeMessage
{
    [JsonPropertyName("role")]
    public string? Role { get; set; }

    [JsonPropertyName("content")]
    public object? Content { get; set; }
}
