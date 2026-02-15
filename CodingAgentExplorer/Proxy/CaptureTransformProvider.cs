using System.Diagnostics;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using CodingAgentExplorer.Hubs;
using CodingAgentExplorer.Models;
using CodingAgentExplorer.Services;
using Microsoft.AspNetCore.SignalR;
using Yarp.ReverseProxy.Transforms;
using Yarp.ReverseProxy.Transforms.Builder;

namespace CodingAgentExplorer.Proxy;

public class CaptureTransformProvider : ITransformProvider
{
    public void ValidateRoute(TransformRouteValidationContext context) { }
    public void ValidateCluster(TransformClusterValidationContext context) { }

    public void Apply(TransformBuilderContext context)
    {
        context.AddRequestTransform(requestContext
            => CaptureRequestAsync(requestContext.HttpContext));

        context.AddResponseTransform(CaptureResponseAsync);
    }

    private static async ValueTask CaptureRequestAsync(HttpContext httpContext)
    {
        var request = httpContext.Request;

        // Enable buffering so we can read the body
        request.EnableBuffering();

        string? body = null;
        if (request.ContentLength > 0 || request.Headers.ContentType.Count > 0)
        {
            request.Body.Position = 0;
            using var reader = new StreamReader(request.Body, Encoding.UTF8, leaveOpen: true);
            body = await reader.ReadToEndAsync();
            request.Body.Position = 0;
        }

        var proxiedRequest = new ProxiedRequest
        {
            Method = request.Method,
            Path = request.Path + request.QueryString,
            RequestBody = body
        };

        CopyHeadersWithRedaction(request.Headers, proxiedRequest.RequestHeaders);

        // Parse request body for metadata
        if (!string.IsNullOrEmpty(body))
        {
            try
            {
                var parsed = JsonSerializer.Deserialize<ClaudeRequestBody>(body);
                if (parsed != null)
                {
                    proxiedRequest.Model = parsed.Model;
                    proxiedRequest.IsStreaming = parsed.Stream ?? false;
                    proxiedRequest.MaxTokens = parsed.MaxTokens;
                }
            }
            catch
            {
                // Not a JSON body we care about
            }
        }

        httpContext.Items["ProxiedRequest"] = proxiedRequest;
        httpContext.Items["Stopwatch"] = Stopwatch.StartNew();
    }

    private static void CopyHeadersWithRedaction(
        IHeaderDictionary source, Dictionary<string, string> target)
    {
        foreach (var header in source)
        {
            if (header.Key.Equals("x-api-key", StringComparison.OrdinalIgnoreCase)
                || header.Key.Equals("Authorization", StringComparison.OrdinalIgnoreCase))
            {
                target[header.Key] = "[REDACTED]";
            }
            else
            {
                target[header.Key] = header.Value.ToString();
            }
        }
    }

    private static async ValueTask CaptureResponseAsync(ResponseTransformContext responseContext)
    {
        var httpContext = responseContext.HttpContext;

        if (httpContext.Items["ProxiedRequest"] is not ProxiedRequest proxiedRequest)
            return;
        if (httpContext.Items["Stopwatch"] is not Stopwatch stopwatch)
            return;

        var store = httpContext.RequestServices.GetRequiredService<RequestStore>();
        var hubContext = httpContext.RequestServices
            .GetRequiredService<IHubContext<DashboardHub>>();

        var proxyResponse = responseContext.ProxyResponse;
        if (proxyResponse == null)
        {
            stopwatch.Stop();
            proxiedRequest.DurationMs = stopwatch.Elapsed.TotalMilliseconds;
            proxiedRequest.StatusCode = responseContext.HttpContext.Response.StatusCode;
            store.Add(proxiedRequest);
            await hubContext.Clients.All.SendAsync("NewRequest", proxiedRequest);
            return;
        }

        proxiedRequest.StatusCode = (int)proxyResponse.StatusCode;

        // Copy response headers
        foreach (var header in proxyResponse.Headers)
        {
            proxiedRequest.ResponseHeaders[header.Key] = string.Join(", ", header.Value);
        }
        foreach (var header in proxyResponse.Content.Headers)
        {
            proxiedRequest.ResponseHeaders[header.Key] = string.Join(", ", header.Value);
        }

        var contentType = proxyResponse.Content.Headers.ContentType?.MediaType ?? "";
        var isEventStream = contentType.Contains("text/event-stream");

        if (isEventStream)
        {
            responseContext.SuppressResponseBody = true;
            await HandleSseStreamingAsync(httpContext, proxyResponse, proxiedRequest, stopwatch);
        }
        else
        {
            await HandleNonStreamingResponseAsync(proxyResponse, proxiedRequest, stopwatch);
        }

        store.Add(proxiedRequest);
        await hubContext.Clients.All.SendAsync("NewRequest", proxiedRequest);
    }

    private static async Task HandleSseStreamingAsync(
        HttpContext httpContext, HttpResponseMessage proxyResponse,
        ProxiedRequest proxiedRequest, Stopwatch stopwatch)
    {
        var clientResponse = httpContext.Response;
        clientResponse.ContentType = "text/event-stream";
        clientResponse.Headers.CacheControl = "no-cache";
        clientResponse.Headers.Connection = "keep-alive";

        // Copy other response headers to client
        foreach (var header in proxyResponse.Headers)
        {
            if (!clientResponse.Headers.ContainsKey(header.Key))
            {
                clientResponse.Headers[header.Key] = header.Value.ToArray();
            }
        }

        var upstreamStream = await proxyResponse.Content.ReadAsStreamAsync();
        using var streamReader = new StreamReader(upstreamStream, Encoding.UTF8);
        var clientWriter = clientResponse.Body;

        string? currentEventType = null;
        bool firstTokenSeen = false;

        string? line;
        while ((line = await streamReader.ReadLineAsync()) != null)
        {
            // Write line to client immediately
            var bytes = Encoding.UTF8.GetBytes(line + "\n");
            await clientWriter.WriteAsync(bytes);
            await clientWriter.FlushAsync();

            // Parse SSE event
            if (line.StartsWith("event: "))
            {
                currentEventType = line["event: ".Length..];
            }
            else if (line.StartsWith("data: "))
            {
                var data = line["data: ".Length..];

                proxiedRequest.SseEvents.Add(new SseEvent
                {
                    EventType = currentEventType,
                    Data = data
                });

                ParseSseEventData(proxiedRequest, currentEventType, data,
                    stopwatch, ref firstTokenSeen);
            }
            else if (line == "")
            {
                currentEventType = null;
            }
        }

        stopwatch.Stop();
        proxiedRequest.DurationMs = stopwatch.Elapsed.TotalMilliseconds;
    }

    private static async Task HandleNonStreamingResponseAsync(
        HttpResponseMessage proxyResponse, ProxiedRequest proxiedRequest, Stopwatch stopwatch)
    {
        await proxyResponse.Content.LoadIntoBufferAsync();
        var body = await ReadResponseBodyAsync(proxyResponse);
        proxiedRequest.ResponseBody = body;

        stopwatch.Stop();
        proxiedRequest.DurationMs = stopwatch.Elapsed.TotalMilliseconds;

        ParseNonStreamingResponse(proxiedRequest, body);
    }

    private static void ParseSseEventData(ProxiedRequest request, string? eventType,
        string data, Stopwatch stopwatch, ref bool firstTokenSeen)
    {
        if (data == "[DONE]") return;

        try
        {
            using var doc = JsonDocument.Parse(data);
            var root = doc.RootElement;

            switch (eventType)
            {
                case "message_start":
                    if (root.TryGetProperty("message", out var message))
                    {
                        if (message.TryGetProperty("id", out var id))
                            request.MessageId = id.GetString();

                        if (message.TryGetProperty("usage", out var usage))
                        {
                            if (usage.TryGetProperty("input_tokens", out var inputTokens))
                                request.InputTokens = inputTokens.GetInt32();
                            if (usage.TryGetProperty("cache_creation_input_tokens", out var cacheCreate))
                                request.CacheCreationInputTokens = cacheCreate.GetInt32();
                            if (usage.TryGetProperty("cache_read_input_tokens", out var cacheRead))
                                request.CacheReadInputTokens = cacheRead.GetInt32();
                        }
                    }
                    break;

                case "content_block_delta":
                    if (!firstTokenSeen)
                    {
                        firstTokenSeen = true;
                        request.TimeToFirstTokenMs = stopwatch.Elapsed.TotalMilliseconds;
                    }
                    break;

                case "message_delta":
                    if (root.TryGetProperty("delta", out var delta))
                    {
                        if (delta.TryGetProperty("stop_reason", out var stopReason))
                            request.StopReason = stopReason.GetString();
                    }
                    if (root.TryGetProperty("usage", out var deltaUsage))
                    {
                        if (deltaUsage.TryGetProperty("output_tokens", out var outputTokens))
                            request.OutputTokens = outputTokens.GetInt32();
                    }
                    break;
            }
        }
        catch
        {
            // Ignore parse errors in SSE data
        }
    }

    private static async Task<string> ReadResponseBodyAsync(HttpResponseMessage response)
    {
        var contentEncoding = response.Content.Headers.ContentEncoding.FirstOrDefault();
        var rawBytes = await response.Content.ReadAsByteArrayAsync();

        Stream decodedStream = contentEncoding?.ToLowerInvariant() switch
        {
            "gzip" => new GZipStream(new MemoryStream(rawBytes), CompressionMode.Decompress),
            "br" => new BrotliStream(new MemoryStream(rawBytes), CompressionMode.Decompress),
            "deflate" => new DeflateStream(new MemoryStream(rawBytes), CompressionMode.Decompress),
            _ => new MemoryStream(rawBytes)
        };

        using var reader = new StreamReader(decodedStream, Encoding.UTF8);
        return await reader.ReadToEndAsync();
    }

    private static void ParseNonStreamingResponse(ProxiedRequest request, string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;

            if (root.TryGetProperty("id", out var id))
                request.MessageId = id.GetString();

            if (root.TryGetProperty("stop_reason", out var stopReason))
                request.StopReason = stopReason.GetString();

            if (root.TryGetProperty("usage", out var usage))
            {
                if (usage.TryGetProperty("input_tokens", out var inputTokens))
                    request.InputTokens = inputTokens.GetInt32();
                if (usage.TryGetProperty("output_tokens", out var outputTokens))
                    request.OutputTokens = outputTokens.GetInt32();
                if (usage.TryGetProperty("cache_creation_input_tokens", out var cacheCreate))
                    request.CacheCreationInputTokens = cacheCreate.GetInt32();
                if (usage.TryGetProperty("cache_read_input_tokens", out var cacheRead))
                    request.CacheReadInputTokens = cacheRead.GetInt32();
            }

            if (root.TryGetProperty("model", out var model))
                request.Model ??= model.GetString();
        }
        catch
        {
            // Not a JSON response we can parse
        }
    }
}
