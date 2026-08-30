import { chromium } from 'playwright';
import 'dotenv/config';
import fs from 'fs';
import cron from 'node-cron';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const PRODUCTS_TO_TEST = [
  {
    name: 'Látex Denver 20 Lts',
    url: 'https://www.pintureriasambito.com/latex-interior-denver-premium-lavable-20-lts/p'
  },
  {
    name: 'Látex Tersuave Antimanchas 20 Lts',
    url: 'https://www.pintureriasambito.com/latex-interior-lavable-antimanchas-tersuave-20-lts/p'
  }
];

const SHIPPING_ZONES = [
  { name: 'Mar del Plata', postalCode: '7600' },
  { name: 'La Florida (Buenos Aires)', postalCode: '1879' }
];

async function sendTelegramAlert(message) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      })
    });
  } catch (err) {
    console.error('Error enviando texto a Telegram:', err.message);
  }
}

async function sendTelegramPhoto(imagePath, caption) {
  if (!BOT_TOKEN || !CHAT_ID || !fs.existsSync(imagePath)) return;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
  try {
    const fileBuffer = fs.readFileSync(imagePath);
    const blob = new Blob([fileBuffer], { type: 'image/png' });

    const formData = new FormData();
    formData.append('chat_id', CHAT_ID);
    formData.append('photo', blob, 'error.png');
    formData.append('caption', caption);

    await fetch(url, { method: 'POST', body: formData });
    console.log('📸 Captura enviada a Telegram.');
  } catch (err) {
    console.error('Error enviando captura a Telegram:', err.message);
  }
}

async function runCheckoutAudit() {
  console.log(`\n⏰ [${new Date().toLocaleTimeString('es-AR')}] Iniciando ciclo de auditoría...`);

  const browser = await chromium.launch({ headless: true });

  for (const product of PRODUCTS_TO_TEST) {
    for (const zone of SHIPPING_ZONES) {
      const context = await browser.newContext({
        viewport: { width: 1366, height: 768 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      });
      const page = await context.newPage();

      try {
        console.log(`\n🔍 Auditando: ${product.name} | Zona: ${zone.name} (${zone.postalCode})`);

        // 1. Cargar la PDP
        await page.goto(product.url, { timeout: 40000, waitUntil: 'domcontentloaded' });

        // 2. Simular cálculo de envío en PDP si el input está disponible
        const zipInput = page.locator('input[placeholder*="código postal" i], input[placeholder*="CP" i], input[name*="postalCode" i]').first();
        if (await zipInput.isVisible({ timeout: 4000 }).catch(() => false)) {
          await zipInput.fill(zone.postalCode);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(2000);
        }

        // 3. Localizar y hacer clic en el botón de compra
        const buyButton = page.locator('button:has-text("Comprar"), button:has-text("Agregar al carrito"), .vtex-add-to-cart-button-0-x-buttonText').first();
        await buyButton.waitFor({ state: 'visible', timeout: 15000 });
        
        // Escuchar la petición de agregado al carrito de VTEX en paralelo al clic
        const [orderFormResponse] = await Promise.all([
          page.waitForResponse(resp => resp.url().includes('/checkout/pub/orderForm') || resp.url().includes('/items'), { timeout: 20000 }).catch(() => null),
          buyButton.click()
        ]);

        // 4. Validar que se haya agregado al carrito o que abra el minicart
        await page.waitForTimeout(2000);
        const minicartVisible = await page.locator('.vtex-minicart-2-x-drawer, .vtex-minicart-2-x-container, a[href*="/checkout"]').first().isVisible({ timeout: 5000 }).catch(() => false);

        if (!orderFormResponse && !minicartVisible) {
          throw new Error('El botón de compra no disparó la orden de pedido ni abrió el minicart.');
        }

        console.log(`✅ OK: ${product.name} validado para ${zone.name}`);
      } catch (error) {
        console.error(`❌ Fallo en ${product.name} (${zone.name}):`, error.message);

        const screenshotPath = `error_${zone.postalCode}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);

        const errorMsg = `🚨 *ALERTA: Error en Tienda Ámbito*\n\n` +
                         `*Producto:* ${product.name}\n` +
                         `*Zona:* ${zone.name} (${zone.postalCode})\n` +
                         `*Detalle:* \`${error.message}\`\n` +
                         `*Hora:* ${new Date().toLocaleTimeString('es-AR')}`;

        await sendTelegramAlert(errorMsg);
        await sendTelegramPhoto(screenshotPath, `Fallo detectado: ${zone.name}`);
      } finally {
        await context.close();
      }
    }
  }

  await browser.close();
  console.log('\n🏁 Ciclo de monitoreo completado.');
}

// Ejecución inmediata
runCheckoutAudit();

// Se ejecutará automáticamente en el minuto 0 de cada hora (ej: 10:00, 11:00, 12:00)
cron.schedule('0 * * * *', () => {
  runCheckoutAudit();
});