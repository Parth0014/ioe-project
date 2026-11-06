async (page) => {
  await page.goto('http://127.0.0.1:8877/analytics?range=24h&mode=DEMO');
  if (page.url().includes('/login')) {
    await page.getByLabel('Dashboard password').fill('gridscope-browser-test');
    await page.getByRole('button', {name:'Sign in',exact:true}).click();
    await page.getByLabel('Readings',{exact:true}).selectOption('DEMO');
  }
  await page.locator('#report').waitFor({state:'visible'});
  await page.getByRole('radio',{name:'30 days',exact:true}).check();
  await page.waitForFunction(()=>document.querySelector('#bucket-label').textContent.includes('Daily') && !document.querySelector('#report').hidden);
  if (!(await page.locator('#energy').textContent()).match(/[1-9]/)) throw new Error('Demo report should contain measured fixture energy');
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export summary'}).click();
  const download=await downloadPromise;
  await download.saveAs('output/playwright/analytics-export.csv');
  await page.getByText('View the chart as a table',{exact:true}).click();
  if (await page.locator('#table-body tr').count()<30) throw new Error('Missing daily table intervals');
  await page.getByText('Gateway details',{exact:true}).click();
  await page.setViewportSize({width:375,height:900});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  if(overflow)throw new Error('Mobile page overflows horizontally');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.screenshot({path:'output/playwright/cloud-mobile-full.png',fullPage:true});
  await page.route('**/api/analytics?**',route=>route.abort());
  await page.getByRole('button',{name:'Refresh data',exact:true}).click();
  await page.locator('#error').waitFor({state:'visible'});
  if(await page.locator('#report').isHidden())throw new Error('Refresh error should retain the previous report');
  await page.screenshot({path:'output/playwright/refresh-error.png'});
  await page.unroute('**/api/analytics?**');
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await page.locator('#error').waitFor({state:'hidden'});
  await page.getByLabel('Readings',{exact:true}).selectOption('LIVE');
  await page.locator('#empty').waitFor({state:'visible'});
  if(await page.locator('#demo-note').isVisible())throw new Error('Demo banner leaked into live mode');
  await page.getByLabel('Readings',{exact:true}).selectOption('DEMO');
  await page.locator('#demo-note').waitFor({state:'visible'});
  await page.locator('#report').waitFor({state:'visible'});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'output/playwright/cloud-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.waitForURL('**/login');
  await page.keyboard.press('Tab');
  const focus=await page.evaluate(()=>document.activeElement.id);
  console.log(JSON.stringify({range:'30d',export:download.suggestedFilename(),phoneOverflow:overflow,reducedMotion:true,refreshRecovery:true,modeIsolation:true,signOut:true,keyboardFocus:focus}));
}
