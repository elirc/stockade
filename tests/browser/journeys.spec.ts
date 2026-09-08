import {test,expect} from '@playwright/test';
test('storefront persists a cart across reload and keyboard opens bag',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{name:'Your next essentials'})).toBeVisible();
 await page.getByRole('button',{name:'Add to bag',exact:true}).first().click();
 await expect(page.getByRole('button',{name:/Open shopping bag, [1-9]/})).toBeVisible();
 await page.reload();const bag=page.getByRole('button',{name:/Open shopping bag, [1-9]/});await bag.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('button',{name:'Continue to checkout'})).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();await page.screenshot({path:'artifacts/storefront-desktop.png',fullPage:true});
});
test('merchant login, inventory and transfer form render',async({page})=>{
 test.setTimeout(300000);
 await page.goto('/login');await page.getByRole('button',{name:'Merchant workspace',exact:true}).click();
 await page.waitForURL('**/admin',{timeout:120000});
 await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Inventory',exact:true}).first().click();await page.waitForURL('**/admin/inventory',{timeout:120000});await expect(page.getByRole('heading',{name:'Inventory',exact:true})).toBeVisible();
 await expect(page.getByRole('columnheader',{name:'Available',exact:true})).toBeVisible({timeout:120000});
 await page.getByRole('link',{name:'Transfers',exact:true}).click();await page.waitForURL('**/admin/transfers',{timeout:120000});await page.getByRole('button',{name:'New transfer'}).click();
 await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByLabel('From warehouse')).toBeVisible();await page.keyboard.press('Escape');await page.screenshot({path:'artifacts/admin-transfers.png',fullPage:true});
});
test('mobile storefront fits and navigation remains operable',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await expect(page.getByRole('heading',{name:'Your next essentials'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();await page.screenshot({path:'artifacts/storefront-mobile.png',fullPage:true});
});
