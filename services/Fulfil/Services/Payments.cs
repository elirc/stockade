using System.Net.Http.Headers;
using System.Text.Json.Nodes;
using Fulfil.Domain;
namespace Fulfil.Services;

public record PaymentResult(string Id, string State, string? ClientSecret = null, long? Amount = null, string? Currency = null, long? CapturedAmount = null);
public sealed class PaymentDeclined(string message) : Exception(message);
public sealed class Payments(IConfiguration configuration, IHttpClientFactory clients, IHostEnvironment environment)
{
    public string Mode => configuration["Payments:Mode"] ?? "Stripe";
    public async Task<PaymentResult> Authorize(Order order)
    {
        if (Mode == "Simulator")
        {
            SimulatorGuard();
            if (order.PaymentMethod == "sim_decline") throw new PaymentDeclined("The test card was declined.");
            return new("sim_" + order.Id.ToString("N"), "authorized");
        }
        var json = await Post("payment_intents", new()
        {
            ["amount"] = order.Total.ToString(),
            ["currency"] = "usd",
            ["capture_method"] = "manual",
            ["confirm"] = "true",
            ["payment_method"] = order.PaymentMethod,
            ["payment_method_types[0]"] = "card",
            ["metadata[order_id]"] = order.Id.ToString(),
            ["description"] = "Stockade " + order.Number
        }, "authorize:" + order.Id);
        return Parse(json);
    }
    public async Task<PaymentResult> Retrieve(string id)
    {
        if (Mode == "Simulator") { SimulatorGuard(); return new(id, "authorized"); }
        using var client = Client(); using var response = await client.GetAsync("payment_intents/" + Uri.EscapeDataString(id));
        var json = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
        if (!response.IsSuccessStatusCode) throw new HttpRequestException("Could not reconcile payment status.");
        return Parse(json);
    }
    public async Task<PaymentResult> Capture(Order order)
    {
        if (Mode == "Simulator") { SimulatorGuard(); if (order.PaymentMethod == "sim_capture_fail") throw new PaymentDeclined("Simulated capture failure."); return new(order.ProviderId!, "captured"); }
        return Parse(await Post("payment_intents/" + Uri.EscapeDataString(order.ProviderId!) + "/capture", new() { ["amount_to_capture"] = order.Total.ToString() }, "capture:" + order.Id));
    }
    public async Task Void(Order order)
    {
        if (Mode == "Simulator") { SimulatorGuard(); return; }
        await Post("payment_intents/" + Uri.EscapeDataString(order.ProviderId!) + "/cancel", new(), "void:" + order.Id);
    }
    public async Task<string> Refund(Order order, Refund refund)
    {
        if (Mode == "Simulator") { SimulatorGuard(); return "sim_re_" + refund.Id.ToString("N"); }
        var json = await Post("refunds", new() { ["payment_intent"] = order.ProviderId!, ["amount"] = refund.Amount.ToString(), ["metadata[refund_id]"] = refund.Id.ToString() }, "refund:" + refund.Id);
        if (json["amount"]?.GetValue<long>() != refund.Amount || json["currency"]?.GetValue<string>() != "usd") throw new HttpRequestException("Refund amount/currency requires investigation.");
        if (json["status"]?.GetValue<string>() != "succeeded") throw new HttpRequestException("Refund outcome requires reconciliation.");
        return json["id"]!.GetValue<string>();
    }
    void SimulatorGuard() { if (!environment.IsDevelopment() && configuration["Payments:AllowSimulator"] != "true") throw new InvalidOperationException("Payment simulator requires Development or explicit Payments:AllowSimulator."); }
    HttpClient Client()
    {
        var key = configuration["Payments:StripeSecretKey"] ?? "";
        if (!key.StartsWith("sk_test_")) throw new InvalidOperationException("Configure a Stripe test-mode secret key. Live payments are disabled.");
        var client = clients.CreateClient("payments"); client.BaseAddress = new Uri("https://api.stripe.com/v1/"); client.Timeout = TimeSpan.FromSeconds(20);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", key); return client;
    }
    async Task<JsonNode> Post(string path, Dictionary<string, string> fields, string key)
    {
        using var client = Client(); using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = new FormUrlEncodedContent(fields) };
        request.Headers.Add("Idempotency-Key", key); using var response = await client.SendAsync(request);
        var json = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
        if (!response.IsSuccessStatusCode)
        {
            if ((int)response.StatusCode == 402) throw new PaymentDeclined(json["error"]?["message"]?.GetValue<string>() ?? "Payment declined.");
            throw new HttpRequestException("Stripe returned an uncertain or invalid payment response: " + (int)response.StatusCode);
        }
        return json;
    }
    static PaymentResult Parse(JsonNode json) => new(json["id"]!.GetValue<string>(), json["status"]?.GetValue<string>() switch
    { "requires_capture" => "authorized", "succeeded" => "captured", "requires_action" => "action_required", "canceled" => "voided", _ => "unknown" }, json["client_secret"]?.GetValue<string>(), json["amount"]?.GetValue<long>(), json["currency"]?.GetValue<string>(), json["amount_received"]?.GetValue<long>());
}
