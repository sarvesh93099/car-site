import { test, expect } from '@playwright/test';

test('care finder uses live catalogue details and adds to the existing request', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.product-card').first()).toBeVisible();
  await page.locator('[data-open-finder]').first().click();
  await page.locator('#finder-form [name="goal"][value="Coatings"]').check();
  await page.locator('#finder-form [type="submit"]').click();
  await expect(page.locator('.finder-result')).toHaveCount(3);
  const ceramic = page.locator('.finder-result').filter({ hasText: 'Ceramic Coating' });
  await expect(ceramic).toContainText('24,999');
  await ceramic.getByRole('button', { name: 'Add Ceramic Coating to your request', exact: true }).click();
  await expect(page.locator('#basket-count')).toHaveText('1');
  await page.locator('[data-finder-browse]').click();
  await expect(page.locator('#finder-dialog')).toBeHidden();
  await expect(page.locator('.product-card')).toHaveCount(3);
  await expect(page.locator('[data-category="Coatings"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#basket-open').click();
  await expect(page.locator('#basket-items')).toContainText('Ceramic Coating');
  await expect(page.locator('#basket-total')).toContainText('24,999');
  expect(errors).toEqual([]);
});

test('finder handles an unavailable category without inventing recommendations', async ({ page }) => {
  await page.route('**/api/products', async route => {
    const response = await route.fetch();
    const products = await response.json();
    await route.fulfill({ response, json: products.filter(product => product.category !== 'Protection') });
  });
  await page.goto('/');
  await expect(page.locator('.product-card').first()).toBeVisible();
  await page.locator('[data-open-finder]').first().click();
  await page.locator('#finder-form [value="Protection"]').check();
  await page.locator('#finder-form [type="submit"]').click();
  await expect(page.locator('#finder-results')).toContainText('No matching options right now');
  await expect(page.locator('.finder-result')).toHaveCount(0);
  await expect(page.locator('#finder-reset')).toBeVisible();
  await page.locator('#finder-reset').click();
  await expect(page.locator('#finder-results')).toBeHidden();
  await expect(page.locator('#finder-reset')).toBeHidden();
  await expect(page.locator('#finder-form [value="Protection"]')).not.toBeChecked();
  await page.locator('#finder-form [value="Protection"]').check();
  await page.locator('#finder-form [type="submit"]').click();
  await page.locator('[data-finder-browse]').click();
  await expect(page.locator('[data-category="All"]')).toHaveAttribute('aria-pressed', 'true');
});

test('care finder retries catalogue loading if the first catalogue request fails', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/products', async route => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Collection temporarily unavailable.' }) });
      return;
    }
    await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('#products')).toContainText('Collection temporarily unavailable.');
  await page.locator('[data-open-finder]').first().click();
  await page.locator('#finder-form [name="goal"][value="Protection"]').check();
  await page.locator('#finder-form [type="submit"]').click();
  await expect(page.locator('.finder-result')).toHaveCount(1);
  await expect(page.locator('.finder-result')).toContainText('Paint Protection Film');
  await expect(page.locator('#finder-error')).toBeEmpty();
  await expect(page.locator('.product-card')).toHaveCount(18);
});

test('comparison persists across filtering, limits selections and supports keyboard dialogs', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#compare-open')).toBeDisabled();
  const compare = name => page.getByRole('button', { name: `Compare ${name}`, exact: true });
  await compare('Ceramic Coating').click();
  await expect(page.locator('#compare-open')).toBeDisabled();
  await compare('Graphene Coating').click();
  await compare('Teflon / Body Wax').click();
  await compare('Paint Protection Film').click();
  await expect(page.locator('#toast')).toContainText('Compare up to three');
  await expect(page.locator('#compare-count')).toHaveText('3');
  await expect(compare('Paint Protection Film')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#search').fill('Ceramic');
  await expect(compare('Ceramic Coating')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#compare-open').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#compare-dialog')).toBeVisible();
  await expect(page.locator('.comparison-table')).toContainText('Graphene Coating');
  await expect(page.locator('.comparison-table')).toContainText('34,999');
  await page.locator('#compare-dialog').getByRole('button', { name: 'Add Graphene Coating to your request', exact: true }).click();
  await expect(page.locator('#basket-count')).toHaveText('1');
  await page.keyboard.press('Escape');
  await expect(page.locator('#compare-dialog')).toBeHidden();
  await expect(page.locator('#compare-open')).toBeFocused();
  await page.locator('#compare-open').click();
  await page.locator('#compare-clear').click();
  await expect(page.locator('#compare-dialog')).toBeHidden();
  await expect(page.locator('#compare-content')).toBeEmpty();
  await expect(page.locator('#compare-count')).toHaveText('0');
  await expect(page.locator('#compare-open')).toBeDisabled();
  await expect(compare('Ceramic Coating')).toBeFocused();
});

test('catalogue sorting keeps custom quotes last and search has a working reset', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.product-card').first()).toBeVisible();
  await page.locator('#catalogue-sort').selectOption('price-high');
  await expect(page.locator('.product-card').first()).toContainText('Paint Protection Film');
  await expect(page.locator('.product-card').last()).toContainText('V31 Concepts Package');
  await page.locator('#catalogue-sort').selectOption('price-low');
  const prices = await page.locator('.product-card [data-add]').evaluateAll(buttons => buttons.map(button => button.dataset.add));
  expect(prices.indexOf('exterior')).toBeLessThan(prices.indexOf('ceramic'));
  expect(prices.at(-1)).toBe('v31-concept');
  await page.locator('#search').fill('nothing-matches-v31-12893');
  await expect(page.locator('.product-card')).toHaveCount(0);
  await page.locator('[data-reset-filters]').click();
  await expect(page.locator('#search')).toHaveValue('');
  await expect(page.locator('.product-card').first()).toBeVisible();
  await expect(page.locator('.product-card').last()).toContainText('V31 Concepts Package');
});

test('mobile navigation closes with Escape and links, and FAQ works from the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('#menu-toggle').click();
  await expect(page.locator('#menu-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#main-nav')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#menu-toggle')).toBeFocused();
  await page.locator('#menu-toggle').click();
  await page.locator('#main-nav a[href="#catalogue"]').click();
  await expect(page.locator('#menu-toggle')).toHaveAttribute('aria-expanded', 'false');
  const faq = page.locator('#questions details').first();
  await faq.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(faq).toHaveAttribute('open', '');
  await page.keyboard.press('Enter');
  await expect(faq).not.toHaveAttribute('open', '');
});

for (const width of [320, 375, 768, 1024, 1440, 1920]) {
  test(`storefront and new dialogs fit ${width}px with reduced motion`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator('.product-card').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('[data-open-finder]').first().click();
    expect(await page.locator('#finder-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
    await page.locator('#finder-form [value="V31 detailing"]').check();
    await page.locator('#finder-form [type="submit"]').click();
    await expect(page.locator('.finder-result')).toHaveCount(4);
    expect(await page.locator('#finder-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Compare Ceramic Coating', exact: true }).click();
    await page.getByRole('button', { name: 'Compare Graphene Coating', exact: true }).click();
    await page.locator('#compare-open').click();
    expect(await page.locator('#compare-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
    expect(await page.locator('.comparison-scroll').evaluate(element => element.scrollWidth >= element.clientWidth)).toBe(true);
  });
}
