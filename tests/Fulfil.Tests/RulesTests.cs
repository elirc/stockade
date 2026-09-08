using Fulfil.Domain;
using Xunit;
namespace Fulfil.Tests;
public class RulesTests
{
    [Theory]
    [InlineData("reserved","fulfilled")]
    [InlineData("paid","authorized")]
    [InlineData("cancelled","paid")]
    [InlineData("fulfilled","reserved")]
    public void Illegal_transitions_do_not_change_state(string initial,string target)
    {var o=new Order{State=initial};Assert.Throws<DomainError>(()=>Rules.Transition(o,target));Assert.Equal(initial,o.State);}
    [Fact] public void Every_state_has_a_definition_and_targets_are_known()
    {foreach(var state in Rules.Transitions)foreach(var target in state.Value)Assert.True(Rules.Transitions.ContainsKey(target));}
    [Fact] public void Full_order_progression_preserves_legal_transitions()
    {var o=new Order();foreach(var state in new[]{"authorized","placed","paid","partially_fulfilled","fulfilled","partially_returned","closed"})Rules.Transition(o,state);Assert.Equal("closed",o.State);}
    [Theory][InlineData(1,825,0)][InlineData(100,825,8)][InlineData(10000,825,825)][InlineData(50,1000,5)]
    public void Tax_uses_integer_half_up_rounding(long amount,int rate,long expected)=>Assert.Equal(expected,Rules.Tax(amount,rate));
    [Fact] public void Partial_returns_conserve_discounted_tax_inclusive_total()
    {var line=new OrderLine(Guid.NewGuid(),"SKU","Product","",3,100,1,24);var refunds=Enumerable.Range(0,3).Select(i=>Rules.ReturnValue(line,1,i)).ToList();Assert.Equal(323,refunds.Sum());Assert.Equal(323,Rules.ReturnValue(line,3,0));}
    [Fact] public void Fixed_discount_cannot_make_an_order_negative()
    {var lines=new List<OrderLine>{new(Guid.NewGuid(),"SKU","Product","",1,200,0,0)};Assert.Equal(200,Rules.Discount(new Promotion{Kind="fixed",Value=500},lines,200));}
    [Fact] public void Bogo_discounts_complete_pairs_only()
    {var lines=new List<OrderLine>{new(Guid.NewGuid(),"SKU","Product","",5,200,0,0)};Assert.Equal(400,Rules.Discount(new Promotion{Kind="bogo"},lines,1000));}
    [Fact] public void Duplicate_products_are_rejected_before_allocation()
    {var id=Guid.NewGuid();Assert.Throws<DomainError>(()=>Rules.PositiveLines([new(id,1),new(id,2)]));}
    [Fact] public void Discount_allocation_conserves_every_cent()
    {var lines=new List<OrderLine>{new(Guid.NewGuid(),"A","A","",2,133,0,0),new(Guid.NewGuid(),"B","B","",1,101,0,0)};var result=Rules.AllocateAmounts(lines,37,825);Assert.Equal(37,result.Sum(x=>x.Discount));Assert.All(result,l=>Assert.InRange(l.Discount,0,l.UnitPrice*l.Quantity));}
    [Fact] public void Warehouse_scope_denies_unassigned_location()
    {var actor=new Actor(Guid.NewGuid(),Guid.NewGuid(),"warehouse",Guid.NewGuid());Assert.Throws<DomainError>(()=>actor.Warehouse(Guid.NewGuid()));}
}
