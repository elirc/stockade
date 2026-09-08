using Fulfil.Services;
using Fulfil.Domain;
using System.Net;
using Xunit;
public class IntegrationSecurityTests
{
    [Fact] public void WebhookSignatureRejectsTamperingAndReplay()
    {
        var body="{\"id\":\"evt_1\"}";var header="t=1000,v1="+Integrations.Sign("secret","1000."+body);
        Assert.True(Integrations.Verify("secret",body,header,1000));
        Assert.False(Integrations.Verify("secret",body+" ",header,1000));
        Assert.False(Integrations.Verify("secret",body,header,1400));
        Assert.False(Integrations.Verify("wrong",body,header,1000));
    }
    [Theory]
    [InlineData("127.0.0.1")][InlineData("10.0.0.1")][InlineData("169.254.169.254")][InlineData("192.168.1.1")][InlineData("::1")][InlineData("::ffff:127.0.0.1")][InlineData("fc00::1")]
    public void WebhooksCannotConnectToPrivateInfrastructure(string address)=>Assert.False(Integrations.PublicAddress(IPAddress.Parse(address)));
    [Fact] public void ProductDiscountNeverMovesOntoAnIneligibleLine()
    {
        var p=Guid.NewGuid();var other=Guid.NewGuid();
        var lines=Rules.AllocateAmounts([new(p,"A","A","",1,1,0,0),new(other,"B","B","",1,100,0,0)],1,0,p);
        Assert.Equal(1,lines[0].Discount);Assert.Equal(0,lines[1].Discount);
    }
    [Fact] public void RoundingDoesNotExceedAnyLinePrice()
    {
        var lines=Enumerable.Range(0,4).Select(_=>new OrderLine(Guid.NewGuid(),"A","A","",1,1,0,0)).ToList();
        var result=Rules.AllocateAmounts(lines,3,825);
        Assert.Equal(3,result.Sum(x=>x.Discount));Assert.All(result,x=>Assert.InRange(x.Discount,0,1));
    }
    [Fact] public void ProviderCaptureMustMatchImmutableMoney()
    {
        var order=new Order{Total=1000};
        Assert.Throws<HttpRequestException>(()=>Worker.ValidatePayment(order,new PaymentResult("pi","captured",Amount:1000,Currency:"usd",CapturedAmount:999)));
        Assert.Throws<HttpRequestException>(()=>Worker.ValidatePayment(order,new PaymentResult("pi","authorized",Amount:1000,Currency:"eur")));
        Worker.ValidatePayment(order,new PaymentResult("pi","captured",Amount:1000,Currency:"usd",CapturedAmount:1000));
    }
}
