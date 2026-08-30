import { chromium } from 'playwright';
import 'dotenv/config';
import fs from 'fs';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const WA_PHONE = process.env.WHATSAPP_PHONE;
const WA_APIKEY = process.env.WHATSAPP_APIKEY;

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

async function sendWhatsAppAlert(text) {
  if (!WA_PHONE || !WA_APIKEY) return;
  const encodedText = encodeURIComponent(text);
  const url = `https://api.callmebot.com/whatsapp.php?phone=${WA_PHONE}&text=${encodedText}&apikey=${WA_APIKEY}`;

  try {
    const res = await fetch(url);
    if (res.ok) console.log('📲 Alerta enviada por WhatsApp.');
  } catch (err) {
    console.error('Error enviando a WhatsApp:', err.message);
  }
}

async function sendTelegramAlert(message) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: 'Markdown' })
    });
  } catch (err) {
    console.error('Error enviando a Telegram:', err.message);
  }
}

async function runCheckoutAudit() {
  console.log(`\n⏰ [${new Date().toLocaleTimeString('es-AR')}] Iniciando ciclo de auditoría...`);

  const browser = await chromium.launch({ headless: true });
  let hasErrors = false;

  for (const product of PRODUCTS_TO_TEST) {
    for (const zone of SHIPPING_ZONES) {
      const context = await browser.newContext({
        viewport: { width: 1366, height: 768 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      });
      const page = await context.newPage();

      try {
        console.log(`\n🔍 Auditando: ${product.name} | Zona: ${zone.name} (${zone.postalCode})`);

        await page.goto(product.url, { timeout: 40000, waitUntil: 'domcontentloaded' });

        const zipInput = page.locator('input[placeholder*="código postal" i], input[placeholder*="CP" i], input[name*="postalCode" i]').first();
        if (await zipInput.isVisible({ timeout: 4000 }).catch(() => false)) {
          await zipInput.fill(zone.postalCode);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(2000);
        }

        const buyButton = page.locator('button:has-text("Comprar"), button:has-text("Agregar al carrito"), .vtex-add-to-cart-button-0-x-buttonText').first();
        await buyButton.waitFor({ state: 'visible', timeout: 15000 });

        const [orderFormResponse] = await Promise.all([
          page.waitForResponse(resp => resp.url().includes('/checkout/pub/orderForm') || resp.url().includes('/items'), { timeout: 20000 }).catch(() => null),
          buyButton.click()
        ]);

        await page.waitForTimeout(2000);
        const minicartVisible = await page.locator('.vtex-minicart-2-x-drawer, .vtex-minicart-2-x-container, a[href*="/checkout"]').first().isVisible({ timeout: 5000 }).catch(() => false);

        if (!orderFormResponse && !minicartVisible) {
          throw new Error('El botón de compra no abrió el minicart ni actualizó la orden.');
        }

        console.log(`✅ OK: ${product.name} validado para ${zone.name}`);
      } catch (error) {
        hasErrors = true;
        console.error(`❌ Fallo en ${product.name} (${zone.name}):`, error.message);

        const errorMsg = `🚨 *ALERTA: Error en Tienda Ámbito*\n\n` +
                         `*Producto:* ${product.name}\n` +
                         `*Zona:* ${zone.name} (${zone.postalCode})\n` +
                         `*Error:* ${error.message}\n` +
                         `*Hora:* ${new Date().toLocaleTimeString('es-AR')}`;

        await sendTelegramAlert(errorMsg);
        await sendWhatsAppAlert(errorMsg);
      } finally {
        await context.close();
      }
    }
  }

  await browser.close();

  // Reporte diario: si la corrida ocurre a las 09:00 AM (UTC-3 hora de Argentina)
  const currentHourAR = (new Date().getUTCHours() - 3 + 24) % 24;
  if (!hasErrors && currentHourAR === 9) {
    const dailyStatus = `✅ *Reporte Diario Tienda Ámbito*\n\nEl monitor automático está activo y el checkout operó con normalidad en todas las zonas.`;
    await sendWhatsAppAlert(dailyStatus);
  }

  console.log('\n🏁 Ciclo de monitoreo completado.');
}

runCheckoutAudit();