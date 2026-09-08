using Fulfil.Data;
using Fulfil.Domain;
using Fulfil.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.RateLimiting;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

var builder = WebApplication.CreateBuilder(args);
// Retried serialization failures are expected; log the final failure at the request/worker boundary.
builder.Logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Critical);
builder.Logging.AddFilter("Microsoft.EntityFrameworkCore.Update", LogLevel.Critical);
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);
builder.Services.AddDbContextFactory<StockadeDb>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("Database")));
builder.Services.AddScoped<Transactions>(); builder.Services.AddScoped<Commerce>(); builder.Services.AddScoped<Payments>();
builder.Services.AddHttpClient(); builder.Services.AddOpenApi();
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
{
    o.Cookie.Name = "stockade_session"; o.Cookie.HttpOnly = true; o.Cookie.SameSite = SameSiteMode.Strict;
    o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
    o.ExpireTimeSpan = TimeSpan.FromHours(8); o.SlidingExpiration = true;
    o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = 401; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = 403; return Task.CompletedTask; };
});
builder.Services.AddAuthorization();
builder.Services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(builder.Environment.ContentRootPath, ".data", "keys")));
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.AddPolicy("login", c => RateLimitPartition.GetFixedWindowLimiter(c.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new() { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});
builder.Services.AddOpenTelemetry().ConfigureResource(r => r.AddService("stockade-fulfil"))
    .WithTracing(t => { t.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation(); if (!string.IsNullOrEmpty(builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"])) t.AddOtlpExporter(); });
if (builder.Configuration["Workers:Enabled"] != "false") builder.Services.AddHostedService<Worker>();
var app = builder.Build();
if (app.Configuration["Schema:Apply"] != "false")
    await using (var scope = app.Services.CreateAsyncScope())
    {
        var db = await scope.ServiceProvider.GetRequiredService<IDbContextFactory<StockadeDb>>().CreateDbContextAsync();
        await Schema.Initialize(db, app.Environment.IsDevelopment() || app.Configuration["SeedDemo"] == "true");
    }
app.Use(async (context, next) =>
{
    try
    {
        if (context.Request.Method is not ("GET" or "HEAD" or "OPTIONS") && !context.Request.Path.StartsWithSegments("/api/v1/stripe/webhook") && !(context.Request.Headers.Authorization.ToString().StartsWith("Bearer ") && !context.Request.Headers.ContainsKey("Cookie")))
        {
            var origin = context.Request.Headers.Origin.ToString();
            var allowed = (app.Configuration["AllowedOrigins"] ?? "http://localhost:3000,http://127.0.0.1:3000").Split(',', StringSplitOptions.TrimEntries);
            if (string.IsNullOrEmpty(origin) || !allowed.Contains(origin)) { context.Response.StatusCode = 403; await context.Response.WriteAsJsonAsync(new { code = "origin", error = "Untrusted request origin." }); return; }
        }
        await next();
    }
    catch (DomainError ex) { context.Response.StatusCode = ex.Status; await context.Response.WriteAsJsonAsync(new { code = ex.Code, error = ex.Message, traceId = context.TraceIdentifier }); }
    catch (Exception ex) when (ex is JsonException or FormatException or InvalidOperationException && ex.Message.Contains("Json"))
    { context.Response.StatusCode = 400; await context.Response.WriteAsJsonAsync(new { code = "invalid_input", error = "Request fields are invalid." }); }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Request failed: {TraceId}", context.TraceIdentifier);
        context.Response.StatusCode = 500; await context.Response.WriteAsJsonAsync(new { code = "server_error", error = "The operation could not be completed. Your stock and payment records were preserved.", traceId = context.TraceIdentifier });
    }
});
app.UseRateLimiter(); app.UseAuthentication();
app.Use(async (c, next) => { await Integrations.AuthenticateKey(c, c.RequestServices.GetRequiredService<IDbContextFactory<StockadeDb>>()); await next(); });
app.UseAuthorization();
app.MapGet("/health", async (IDbContextFactory<StockadeDb> f) => { await using var db = await f.CreateDbContextAsync(); return await db.Database.CanConnectAsync() ? Results.Ok(new { status = "healthy" }) : Results.StatusCode(503); });
var api = app.MapGroup("/api/v1");
api.MapGet("/info", (Payments p, IConfiguration config) => new { project = "Stockade", paymentMode = p.Mode, stripePublicKey = config["Payments:StripePublicKey"], demo = app.Environment.IsDevelopment(), currency = "USD" });
api.MapGet("/merchants", async (IDbContextFactory<StockadeDb> f) => { await using var db = await f.CreateDbContextAsync(); return await db.Merchants.OrderBy(x => x.Name).Select(x => new { x.Id, x.Name, x.Slug }).ToListAsync(); });
api.MapPost("/auth/login", async (HttpContext c, IDbContextFactory<StockadeDb> f, JsonObject input) =>
{
    await using var db = await f.CreateDbContextAsync(); var slug = input.Text("merchant", "northline");
    var merchant = await db.Merchants.SingleOrDefaultAsync(x => x.Slug == slug) ?? throw new DomainError("login", "Invalid credentials.", 401);
    var email = input.Required("email", 200).ToLowerInvariant();
    var account = await db.Accounts.SingleOrDefaultAsync(x => x.MerchantId == merchant.Id && x.Email == email);
    var hasher = new PasswordHasher<Account>();
    if (account == null || account.Guest || hasher.VerifyHashedPassword(account, account.PasswordHash, input.Required("password", 200)) == PasswordVerificationResult.Failed)
        throw new DomainError("login", "Invalid credentials.", 401);
    await Session.SignIn(c, account); return Session.Public(account);
}).RequireRateLimiting("login");
api.MapPost("/auth/register", async (HttpContext c, IDbContextFactory<StockadeDb> f, JsonObject input) =>
{
    await using var db = await f.CreateDbContextAsync();
    var merchant = await db.Merchants.SingleOrDefaultAsync(x => x.Slug == input.Text("merchant", "northline")) ?? throw new DomainError("merchant", "Store not found.", 404);
    var email = input.Required("email", 200).ToLowerInvariant(); if (!System.Net.Mail.MailAddress.TryCreate(email, out _)) throw new DomainError("validation", "Enter a valid email.");
    var guest = input.Flag("guest");
    if (!guest && await db.Accounts.AnyAsync(x => x.MerchantId == merchant.Id && x.Email == email)) throw new DomainError("account_exists", "An account already exists. Sign in instead.", 409);
    var account = new Account { MerchantId = merchant.Id, Name = guest ? email : input.Required("name", 100), Email = guest ? "guest-" + Guid.NewGuid().ToString("N") + "@stockade.local" : email, Guest = guest };
    if (!guest) { var password = input.Required("password", 200); if (password.Length < 12) throw new DomainError("password", "Use at least 12 characters."); account.PasswordHash = new PasswordHasher<Account>().HashPassword(account, password); }
    db.Accounts.Add(account); await db.SaveChangesAsync(); await Session.SignIn(c, account); return Session.Public(account);
}).RequireRateLimiting("login");
api.MapPost("/auth/logout", async (HttpContext c) => { await c.SignOutAsync(); return Results.Ok(new { signedOut = true }); });
var secure = api.MapGroup("").RequireAuthorization();
secure.MapGet("/me", async (HttpContext c, IDbContextFactory<StockadeDb> f) => { await using var db = await f.CreateDbContextAsync(); return Session.Public(await Session.Account(c, db)); });
secure.MapPost("/commands/{operation}", async (string operation, HttpContext c, IDbContextFactory<StockadeDb> f, Commerce commerce, JsonObject input) =>
{
    await using var db = await f.CreateDbContextAsync(); var actor = Session.Actor(await Session.Account(c, db));
    return await commerce.Execute(actor, operation, c.Request.Headers["Idempotency-Key"].ToString(), input, c.RequestAborted);
});
secure.MapPost("/quote", async (HttpContext c, IDbContextFactory<StockadeDb> f, Commerce commerce, JsonObject input) =>
{
    await using var db = await f.CreateDbContextAsync(); var actor = Session.Actor(await Session.Account(c, db));
    await using var snapshot = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead);
    input["checkoutKey"] = "quote:" + Guid.NewGuid();
    var quote = await commerce.Preview(db, actor, input);
    await snapshot.RollbackAsync();
    return quote;
});
secure.MapPost("/exchange-quote", async (HttpContext c, IDbContextFactory<StockadeDb> f, Commerce commerce, JsonObject input) =>
{
    await using var db = await f.CreateDbContextAsync(); var actor = Session.Actor(await Session.Account(c, db));
    await using var snapshot = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead);
    var quote = await commerce.PreviewExchange(db, actor, input); await snapshot.RollbackAsync(); return quote;
});
secure.MapGet("/data/{resource}", ReadApi.List);
secure.MapGet("/orders/{id:guid}", ReadApi.OrderDetail);
secure.MapPost("/reconcile", async (HttpContext c, IDbContextFactory<StockadeDb> f, Transactions tx) =>
{
    await using var read = await f.CreateDbContextAsync(); var a = Session.Actor(await Session.Account(c, read)); a.Demand("owner", "admin");
    return await tx.Run(db => Reconciliation.Run(db, a.MerchantId, c.RequestAborted));
});
secure.MapGet("/state-machine", () => Rules.Transitions);
Integrations.Map(app, api, secure);
if (app.Environment.IsDevelopment()) app.MapOpenApi();
await app.RunAsync();

public static class Session
{
    public static async Task SignIn(HttpContext context, Account a)
    {
        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, a.Id.ToString()), new Claim("merchant", a.MerchantId.ToString()) };
        await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)), new AuthenticationProperties { IsPersistent = false });
    }
    public static async Task<Account> Account(HttpContext c, StockadeDb db)
    {
        if (!Guid.TryParse(c.User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) || !Guid.TryParse(c.User.FindFirstValue("merchant"), out var merchant)) throw new DomainError("unauthorized", "Sign in to continue.", 401);
        return await db.Accounts.SingleOrDefaultAsync(x => x.Id == id && x.MerchantId == merchant) ?? throw new DomainError("unauthorized", "This account is unavailable.", 401);
    }
    public static Actor Actor(Account a) => new(a.Id, a.MerchantId, a.Role, a.WarehouseId);
    public static object Public(Account a) => new { a.Id, a.MerchantId, a.Name, email = a.Guest ? a.Name : a.Email, a.Role, a.WarehouseId, a.Guest };
}
public partial class Program { }
