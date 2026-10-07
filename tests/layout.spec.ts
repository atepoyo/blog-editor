import { expect, test } from '@playwright/test';

for (const width of [320, 390, 768, 1440]) {
  for (const language of ['ja', 'en']) {
    test(`${width}px幅の${language}表示で入力欄の形と余白を揃えフォーカスでも位置を保つ`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      if (language === 'en') await page.getByRole('button', { name: 'English', exact: true }).click();
      const title = page.getByRole('textbox', { name: language === 'ja' ? 'タイトル' : 'Title', exact: true });
      const body = page.getByRole('textbox', { name: language === 'ja' ? '本文' : 'Body', exact: true });
      const layout = await page.evaluate(() => {
        const main = document.querySelector('main');
        const header = document.querySelector('.app-header');
        const title = document.querySelector('.title-input');
        const body = document.querySelector('.body-input');
        if (!(main instanceof HTMLElement) || !(header instanceof HTMLElement) || !(title instanceof HTMLInputElement) || !(body instanceof HTMLTextAreaElement)) throw new Error('入力欄を取得できません。');
        const mainRect = main.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const bodyRect = body.getBoundingClientRect();
        const titleStyle = getComputedStyle(title);
        const bodyStyle = getComputedStyle(body);
        return {
          title: { x: titleRect.x, width: titleRect.width, height: titleRect.height, radius: titleStyle.borderTopLeftRadius, fontSize: titleStyle.fontSize, padding: titleStyle.paddingLeft },
          body: { x: bodyRect.x, width: bodyRect.width, radius: bodyStyle.borderTopLeftRadius, fontSize: bodyStyle.fontSize, padding: bodyStyle.paddingLeft },
          horizontalInset: titleRect.left - mainRect.left,
          topInset: headerRect.top - mainRect.top,
          headerGap: titleRect.top - headerRect.bottom,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(layout.title.x).toBe(layout.body.x);
      expect(layout.title.width).toBe(layout.body.width);
      expect(layout.title.radius).toBe(layout.body.radius);
      expect(layout.title.padding).toBe(layout.body.padding);
      expect(layout.title.fontSize).toBe(layout.body.fontSize);
      expect(parseFloat(layout.title.fontSize)).toBeGreaterThanOrEqual(16);
      expect(layout.topInset).toBe(layout.horizontalInset);
      expect(layout.headerGap).toBeLessThanOrEqual(layout.horizontalInset);
      expect(layout.overflow).toBe(false);
      const brand = await page.locator('.brand').boundingBox();
      const nav = await page.getByRole('navigation').boundingBox();
      if (!brand || !nav) throw new Error('ヘッダーを取得できません。');
      expect(nav.x).toBeGreaterThanOrEqual(24);
      expect(nav.x + nav.width).toBeLessThanOrEqual(width - 24);
      expect(nav.y + nav.height / 2).toBe(brand.y + brand.height / 2);
      expect(nav.x).toBeGreaterThan(brand.x + brand.width);
      const copyButton = page.getByRole('button', { name: language === 'ja' ? 'Markdownをコピー' : 'Copy Markdown', exact: true });
      const postButton = page.getByRole('button', { name: language === 'ja' ? '投稿' : 'Post', exact: true });
      const copyRect = await copyButton.boundingBox();
      const postRect = await postButton.boundingBox();
      if (!copyRect || !postRect) throw new Error('投稿操作を取得できません。');
      expect(Math.abs(copyRect.width - postRect.width)).toBeLessThan(1);
      expect(copyRect.height).toBe(postRect.height);
      if (width >= 360) {
        expect(copyRect.y).toBe(postRect.y);
        expect(copyRect.x).toBeLessThan(postRect.x);
      } else {
        expect(copyRect.x).toBe(postRect.x);
        expect(copyRect.y).toBeLessThan(postRect.y);
      }
      const before = await title.boundingBox();
      await title.focus();
      expect(await title.boundingBox()).toEqual(before);
      await page.screenshot({ path: `test-results/layout-${width}-${language}-title.png`, fullPage: true });
      const titleFocusStyle = await title.evaluate((element) => getComputedStyle(element).outlineOffset);
      await body.fill(language === 'ja' ? '入力した本文\n次の行も同じ位置から始まります。' : 'The body text starts here.\nThe next line shares the same inset.');
      const bodyFocusStyle = await body.evaluate((element) => getComputedStyle(element).outlineOffset);
      expect(bodyFocusStyle).toBe(titleFocusStyle);
      await page.screenshot({ path: `test-results/layout-${width}-${language}-body.png`, fullPage: true });
      await page.getByRole('button', { name: language === 'ja' ? '設定' : 'Settings', exact: true }).click();
      const settingsDialog = await page.getByRole('dialog').boundingBox();
      if (!settingsDialog) throw new Error('設定画面を取得できません。');
      await page.screenshot({ path: `test-results/settings-${width}-${language}.png`, fullPage: true });
      const apply = page.getByRole('button', { name: language === 'ja' ? '設定を反映' : 'Apply settings', exact: true });
      await apply.scrollIntoViewIfNeeded();
      await expect(apply).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.getByRole('button', { name: language === 'ja' ? '閉じる' : 'Close', exact: true }).click();
      await expect(body).toHaveValue(language === 'ja' ? '入力した本文\n次の行も同じ位置から始まります。' : 'The body text starts here.\nThe next line shares the same inset.');
      const editorBeforeHelp = await page.locator('.editor').boundingBox();
      await page.getByRole('button', { name: language === 'ja' ? '使い方' : 'Help', exact: true }).click();
      const helpDialog = page.getByRole('dialog', { name: language === 'ja' ? '使い方' : 'Help', exact: true });
      await expect(helpDialog).toBeVisible();
      await expect(page.getByRole('heading', { name: language === 'ja' ? '使い方' : 'Help', exact: true })).toBeVisible();
      expect(await page.locator('.editor').boundingBox()).toEqual(editorBeforeHelp);
      const helpRect = await helpDialog.boundingBox();
      if (!helpRect) throw new Error('使い方画面を取得できません。');
      expect(helpRect.x).toBe(settingsDialog.x);
      expect(helpRect.width).toBe(settingsDialog.width);
      const textLefts = await helpDialog.locator('h2, h3, p, dt, dd').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().left));
      expect(new Set(textLefts).size).toBe(1);
      expect(await helpDialog.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.screenshot({ path: `test-results/help-${width}-${language}.png`, fullPage: true });
      await page.getByRole('button', { name: language === 'ja' ? '閉じる' : 'Close', exact: true }).click();
      expect(await page.locator('.editor').boundingBox()).toEqual(editorBeforeHelp);
      await expect(body).toHaveValue(language === 'ja' ? '入力した本文\n次の行も同じ位置から始まります。' : 'The body text starts here.\nThe next line shares the same inset.');
      await body.dispatchEvent('contextmenu');
      const photoMenu = page.getByRole('dialog', { name: language === 'ja' ? '写真を追加' : 'Add photo', exact: true });
      await expect(photoMenu).toBeVisible();
      const photoLayout = await photoMenu.evaluate((element) => {
        const heading = element.querySelector('.modal-heading');
        const hint = element.querySelector('.hint');
        const button = element.querySelector('.primary');
        if (!heading || !hint || !button) throw new Error('写真追加画面を取得できません。');
        const headingRect = heading.getBoundingClientRect();
        const hintRect = hint.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const dialogRect = element.getBoundingClientRect();
        return {
          headingGap: hintRect.top - headingRect.bottom,
          actionGap: buttonRect.top - hintRect.bottom,
          left: [headingRect.left, hintRect.left, buttonRect.left],
          bottomInset: dialogRect.bottom - buttonRect.bottom,
          overflow: element.scrollWidth > element.clientWidth,
        };
      });
      expect(photoLayout.headingGap).toBe(24);
      expect(photoLayout.actionGap).toBe(16);
      expect(new Set(photoLayout.left).size).toBe(1);
      expect(photoLayout.bottomInset).toBe(25);
      expect(photoLayout.overflow).toBe(false);
      await page.screenshot({ path: `test-results/photo-menu-${width}-${language}.png`, fullPage: true });
      await page.getByRole('button', { name: language === 'ja' ? '閉じる' : 'Close', exact: true }).click();
      const encoded = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 16;
        return canvas.toDataURL('image/jpeg', 1).split(',')[1] ?? '';
      });
      await page.getByLabel(language === 'ja' ? '写真を選択' : 'Select photo', { exact: true }).setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(encoded, 'base64') });
      const captionDialog = page.getByRole('dialog', { name: language === 'ja' ? 'キャプション' : 'Caption', exact: true });
      await expect(captionDialog).toBeVisible();
      expect(await captionDialog.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
      const captionGaps = await captionDialog.locator('form').evaluate((element) => {
        const rects = [...element.children].map((child) => child.getBoundingClientRect());
        return rects.slice(1).map((rect, index) => rect.top - (rects[index]?.bottom ?? rect.top));
      });
      expect(captionGaps).toEqual([16, 16]);
      await page.screenshot({ path: `test-results/caption-${width}-${language}.png`, fullPage: true });
      await page.getByRole('button', { name: language === 'ja' ? '閉じる' : 'Close', exact: true }).click();
    });
  }
}
