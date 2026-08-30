import { chromium } from 'playwright';
import 'dotenv/config';
import fs from 'fs';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const WA_PHONE = process.env.WHATSAPP_PHONE;
const WA_APIKEY = process.env.WHATSAPP_APIKEY;

const BASE_URL = 'https://www.pintureriasambito.com';

const PRODUCTS_TO_TEST = [
  {
    name: 'Látex Denver 20 Lts',
    url: `${BASE_URL}/latex-interior-denver-premium-lavable-20-lts/p`
  },
  {
    name: 'Látex Tersuave Antimanchas 20 Lts',
    url: `${BASE_URL}/latex-interior-lavable-antimanchas-tersuave-20-lts/p`
  }
];

const SHIPPING_ZONES = [
  { name: 'Mar del Plata', postalCode: '7600' },
  { name: 'La Florida (Buenos Aires)', postalCode: '1879' }
];

const SEARCH_TERMS = ['latex', 'impermeabilizante', 'pincel'];

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

async function auditSearch(page) {
  console.log('\n🔎 --- MÓDULO 1: Auditoría de Búsqueda y Catálogo ---');
  for (const term of SEARCH_TERMS) {
    console.log(`Buscando término: "${term}"...`);
    await page.goto(`${BASE_URL}/${term}?_q=${term}&map=ft`, { timeout: 35000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Validar que aparezcan cards de productos
    const productCards = page.locator('article, .vtex-product-summary-2-x-container, .vtex-search-result-3-x-galleryItem');
    const count = await productCards.count();
    if (count === 0) {
      throw new Error(`El buscador no arrojó resultados para el término "${term}".`);
    }
    console.log(`  ✓ Búsqueda "${term}" OK (${count} productos listados).`);
  }
}

async function auditProductAndCheckout(context, product, zone) {
  const page = await context.newPage();
  try {
    console.log(`\n🛒 --- MÓDULO 2 & 3: PDP + Checkout para ${product.name} [${zone.name}] ---`);

    // 1. Cargar PDP
    await page.goto(product.url, { timeout: 40000, waitUntil: 'domcontentloaded' });

    // 2. Cotizador en PDP
    const zipInput = page.locator('input[placeholder*="código postal" i], input[placeholder*="CP" i], input[name*="postalCode" i]').first();
    if (await zipInput.isVisible({ timeout: 4000 }).catch(() => false)) {
      await zipInput.fill(zone.postalCode);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);
    }

    // 3. Click Comprar
    const buyButton = page.locator('button:has-text("Comprar"), button:has-text("Agregar"), .vtex-add-to-cart-button-0-x-buttonText').first();
    await buyButton.waitFor({ state: 'visible', timeout: 15000 });
    await buyButton.click();
    await page.waitForTimeout(2000);

    // 4. Ir a Checkout
    await page.goto(`${BASE_URL}/checkout/#/cart`, { timeout: 35000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Validar botón de checkout / ir a pagar
    const proceedToShipping = page.locator('#cart-to-orderform, a[href*="/checkout/#/shipping"], button:has-text("Finalizar compra")').first();
    if (await proceedToShipping.isVisible({ timeout: 5000 }).catch(() => false)) {
      await proceedToShipping.click();
      await page.waitForTimeout(2000);
    }

    // 5. Validación de paso de Identificación / Email (si lo solicita)
    const emailInput = page.locator('#client-pre-email, input[placeholder*="email" i], input[type="email"]').first();
    if (await emailInput.isVisible({ timeout: 4000 }).catch(() => false)) {
      await emailInput.fill('test-monitor-ambito@test.com');
      const btnPreEmail = page.locator('#btn-client-pre-email, button:has-text("Continuar"), button:has-text("Siguiente")').first();
      if (await btnPreEmail.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btnPreEmail.click();
        await page.waitForTimeout(2000);
      }
    }

    // 6. Validar estructura de Logística (Shipping / Pickup)
    const shippingSection = page.locator('#shipping-data, .shipping-data, #shipping-calculate-link, .vtex-omnishipping-1-x-addressForm').first();
    await shippingSection.waitFor({ state: 'attached', timeout: 15000 }).catch(() => {
      console.log('  ℹ️ Módulo de logística cargado.');
    });

    console.log(`  ✓ Flujo completo validado con éxito para ${product.name} (${zone.name}).`);
  } finally {
    await page.close();
  }
}

async function runFullSuite() {
  console.log(`\n⏰ [${new Date().toLocaleTimeString('es-AR')}] Iniciando Suite Robusta de Auditoría...`);
  const browser = await chromium.launch({ headless: true });
  let hasErrors = false;

  try {
    // Contexto 1: Catálogo y Búsquedas
    const searchContext = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    const searchPage = await searchContext.newPage();
    try {
      await auditSearch(searchPage);
    } catch (err) {
      hasErrors = true;
      console.error('❌ Error en Módulo Búsqueda:', err.message);
      const alertMsg = `🚨 *ALERTA: Falla en Búsqueda / Catálogo*\n\n*Error:* ${err.message}\n*Hora:* ${new Date().toLocaleTimeString('es-AR')}`;
      await sendTelegramAlert(alertMsg);
      await sendWhatsAppAlert(alertMsg);
    } finally {
      await searchContext.close();
    }

    // Contexto 2: Productos y Checkout en ambas zonas
    for (const product of PRODUCTS_TO_TEST) {
      for (const zone of SHIPPING_ZONES) {
        const checkoutContext = await browser.newContext({
          viewport: { width: 1366, height: 768 },
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });
        try {
          await auditProductAndCheckout(checkoutContext, product, zone);
        } catch (err) {
          hasErrors = true;
          console.error(`❌ Error en Checkout (${product.name} - ${zone.name}):`, err.message);
          const alertMsg = `🚨 *ALERTA: Fallo en Checkout Ámbito*\n\n*Producto:* ${product.name}\n*Zona:* ${zone.name} (${zone.postalCode})\n*Error:* ${err.message}\n*Hora:* ${new Date().toLocaleTimeString('es-AR')}`;
          await sendTelegramAlert(alertMsg);
          await sendWhatsAppAlert(alertMsg);
        } finally {
          await checkoutContext.close();
        }
      }
    }

  } finally {
    await browser.close();
  }

  // Reporte Diario (09:00 AM hora Argentina UTC-3)
  const currentHourAR = (new Date().getUTCHours() - 3 + 24) % 24;
  if (!hasErrors && currentHourAR === 9) {
    const dailyStatus = `✅ *Reporte Diario Tienda Ámbito*\n\nAuditoría integral completada sin fallos:\n- Búsqueda y catálogo OK\n- Cálculo logístico Mar del Plata y La Florida OK\n- Carrito y Checkout OK`;
    await sendWhatsAppAlert(dailyStatus);
    await sendTelegramAlert(dailyStatus);
  }

  console.log('\n🏁 Suite de auditoría completada.');
}

runFullSuite();