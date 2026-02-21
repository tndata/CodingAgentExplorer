using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

// 1. Read all STDIN (Claude Code closes stdin after writing the hook payload)
var stdinJson = await Console.In.ReadToEndAsync();

// 2. Parse to extract envelope fields
JsonNode? root = null;
try { root = JsonNode.Parse(stdinJson); } catch { }

// 3. Collect Claude Code environment variables
var envVars = new Dictionary<string, string>();
foreach (var key in new[] { "CLAUDE_PROJECT_DIR", "CLAUDE_CODE_REMOTE",
                             "CLAUDE_ENV_FILE", "CLAUDE_PLUGIN_ROOT" })
{
    var val = Environment.GetEnvironmentVariable(key);
    if (val is not null) envVars[key] = val;
}

// 4. Build payload matching HookEvent DTO (camelCase, matches ASP.NET Core defaults)
var payload = new
{
    hookEventName        = root?["hook_event_name"]?.GetValue<string>() ?? "",
    sessionId            = root?["session_id"]?.GetValue<string>(),
    cwd                  = root?["cwd"]?.GetValue<string>(),
    permissionMode       = root?["permission_mode"]?.GetValue<string>(),
    transcriptPath       = root?["transcript_path"]?.GetValue<string>(),
    hookInput            = root,          // full original payload
    environmentVariables = envVars,
};

// 5. POST to CodingAgentExplorer dashboard (not the proxy port)
int exitCode = 0;
string stdout = "";
string stderr = "";
try
{
    using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
    var resp = await http.PostAsJsonAsync(
        "http://localhost:5000/api/hook-event", payload,
        new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });

    if (resp.IsSuccessStatusCode)
    {
        var result = await resp.Content.ReadFromJsonAsync<JsonNode>();
        exitCode = result?["exitCode"]?.GetValue<int>() ?? 0;
        stdout   = result?["stdout"]?.GetValue<string>() ?? "";
        stderr   = result?["stderr"]?.GetValue<string>() ?? "";
    }
}
catch
{
    // Server not running — silently succeed; never block Claude Code
}

// 6. Relay stdout/stderr to Claude Code
if (!string.IsNullOrEmpty(stdout)) Console.WriteLine(stdout);
if (!string.IsNullOrEmpty(stderr)) Console.Error.WriteLine(stderr);

Environment.Exit(exitCode);   // Exit code matters for blocking hooks
