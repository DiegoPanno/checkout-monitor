import 'dotenv/config';
import { chromium } from 'playwright';
import https from 'https';
import fs from 'fs';
import path from 'path';

// ==========================================
// CONFIGURACIÓN Y CONSTANTES
// ==========================================
const BASE_URL = 'https://www.pintureriasambito.com';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const SEARCH_TERMS = ['latex', 'impermeabilizante', 'pincel'];

const SCENARIOS = [
  // --- Látex Denver 4 Lts ---
  {
    productName: 'Látex Denver 4 Lts',
    url: `${BASE_URL}/latex-interior-denver-premium-lavable-4-lts/p`,
    zoneName: 'Mar del Plata',
    postalCode: '7600'
  },
  {
    productName: 'Látex Denver 4 Lts',
    url: `${BASE_URL}/latex-interior-denver-premium-lavable-4-lts/p`,
    zoneName: 'La Florida (Buenos Aires)',
    postalCode: '1879'
  },

  // --- Membrana Líquida Venier Supercapa 1 Kg Blanco (SKU 1098) ---
  {
    productName: 'Membrana Líquida Venier Supercapa 1 Kg Blanco (SKU 1098)',
    url: `${BASE_URL}/membrana-liquida-venier-supercapa-poliuretanica-1-kg/p?skuId=1098`,
    zoneName: 'Mar del Plata',
    postalCode: '7600'
  },
  {
    productName: 'Membrana Líquida Venier Supercapa 1 Kg Blanco (SKU 1098)',
    url: `${BASE_URL}/membrana-liquida-venier-supercapa-poliuretanica-1-kg/p?skuId=1098`,
    zoneName: 'La Florida (Buenos Aires)',
    postalCode: '1879'
  }
];

// ==========================================
// UTILIDADES DE NOTIFICACIÓN
// ==========================================
async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID,
    text: text,
    parse_mode: 'HTML'
  });

  return new Promise((resolve) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, () => resolve());
    req.on('error', () => resolve());
    req.write(payload);
    req.end();
  });
}

async function sendTelegramPhoto(imagePath, caption) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !fs.existsSync(imagePath)) return;
  
  const boundary = '----WebKitFormBoundary' + Math.random().toString(16).substring(2);
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
  
  const fileData = fs.readFileSync(imagePath);
  const fileName = path.basename(imagePath);

  let body = [];
  body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${TELEGRAM_CHAT_ID}\r\n`));
  body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`));
  body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${fileName}"\r\nContent-Type: image/png\r\n\r\n`));
  body.push(fileData);
  body.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const totalLength = body.reduce((acc, cur) => acc + cur.length, 0);

  return new Promise((resolve) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': totalLength
      }
    }, () => resolve());
    req.on('error', () => resolve());
    for (const b of body) req.write(b);
    req.end();
  });
}

// ==========================================
// MÓDULO 1: AUDITORÍA DE BÚSQUEDA
// ==========================================
async function auditSearch(page) {
  console.log('🔎 --- MÓDULO 1: Auditoría de Búsqueda y Catálogo ---');
  for (const term of SEARCH_TERMS) {
    try {
      console.log(`Buscando término: "${term}"...`);
      await page.goto(`${BASE_URL}/${term}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
      
      const productElements = page.locator('.vtex-search-result-3-x-galleryItem, .vtex-product-summary-2-x-container');
      await productElements.first().waitFor({ state: 'visible', timeout: 10000 });
      const count = await productElements.count();
      
      console.log(`  ✓ Búsqueda "${term}" OK (${count} productos listados).`);
    } catch (err) {
      console.log(`  ❌ Fallo en búsqueda "${term}": ${err.message}`);
      await sendTelegramMessage(`⚠️ <b>Alerta Búsqueda</b>: Sin resultados para término <code>${term}</code>.`);
    }
  }
}

// ==========================================
// MÓDULO 2 Y 3: AUDITORÍA DE CHECKOUT
// ==========================================
async function auditCheckoutScenario(browser, scenario) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();
  const scenarioTitle = `${scenario.productName} [${scenario.zoneName}]`;
  console.log(`🛒 --- MÓDULO 2 & 3: PDP + Checkout para ${scenarioTitle} ---`);

  try {
    // 1. Navegar a la ficha de producto
    await page.goto(scenario.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 2. Click en botón Comprar
    const buyButton = page.locator('.vtex-add-to-cart-button-0-x-buttonText, button:has-text("Comprar"), button:has-text("Agregar al carrito")').first();
    await buyButton.waitFor({ state: 'visible', timeout: 15000 });
    
    await Promise.all([
      page.waitForResponse(res => res.url().includes('/orderForm') && res.status() === 200, { timeout: 15000 }).catch(() => null),
      buyButton.click()
    ]);

    // 3. Ir a la vista de carrito
    await page.goto(`${BASE_URL}/checkout/#/cart`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    // 4. Inyectar datos directamente en la API de VTEX
    await page.waitForFunction(() => typeof window.vtexjs !== 'undefined' && window.vtexjs.checkout, { timeout: 20000 });

    const result = await page.evaluate(async (postalCode) => {
      try {
        await window.vtexjs.checkout.sendAttachment('clientProfileData', {
          email: 'auditoria_monitor@ingacot.com.ar',
          firstName: 'Auditor',
          lastName: 'Sistema',
          document: '32123456',
          phone: '+5492234000000'
        });

        const orderForm = await window.vtexjs.checkout.sendAttachment('shippingData', {
          selectedAddresses: [{
            addressType: 'residential',
            postalCode: postalCode,
            country: 'ARG'
          }]
        });

        const slas = orderForm?.shippingData?.logisticsInfo?.[0]?.slas || [];
        return {
          success: true,
          slaCount: slas.length,
          messages: orderForm.messages || []
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }, scenario.postalCode);

    if (!result.success) {
      throw new Error(`Fallo al enviar datos a VTEX: ${result.error}`);
    }

    // 5. Ir a la pantalla de envío para verificar visualmente
    await page.goto(`${BASE_URL}/checkout/#/shipping`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2500);

    // 6. Validación de bloqueos
    const alertWarning = page.getByText(/El siguiente ítem no puede enviarse|no puede enviarse a este código postal/i);
    if (await alertWarning.isVisible()) {
      throw new Error(`Ítem bloqueado para CP ${scenario.postalCode} ("No puede enviarse a este código postal")`);
    }

    if (result.slaCount === 0) {
      throw new Error(`Sin opciones de logística / retiro disponibles para CP ${scenario.postalCode} (SLAs = 0)`);
    }

    console.log(`  ✓ Checkout OK para ${scenarioTitle} (${result.slaCount} opciones disponibles).`);

  } catch (err) {
    console.log(`❌ Error en Checkout (${scenarioTitle}): ${err.message}`);

    const screenshotPath = `error_${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const errorCaption = `🚨 <b>Fallo en Checkout Ámbito</b>\n\n<b>Producto:</b> ${scenario.productName}\n<b>Zona:</b> ${scenario.zoneName} (${scenario.postalCode})\n<b>Error:</b> ${err.message}`;

    await sendTelegramPhoto(screenshotPath, errorCaption);
    console.log('📸 Captura enviada a Telegram.');

    if (fs.existsSync(screenshotPath)) {
      fs.unlinkSync(screenshotPath);
    }
  } finally {
    await context.close();
  }
}

// ==========================================
// EJECUCIÓN PRINCIPAL
// ==========================================
(async () => {
  const now = new Date().toLocaleTimeString('es-AR');
  console.log(`⏰ [${now}] Iniciando Suite Robusta de Auditoría...`);

  const browser = await chromium.launch({ headless: true });

  try {
    const searchContext = await browser.newContext();
    const searchPage = await searchContext.newPage();
    await auditSearch(searchPage);
    await searchContext.close();

    for (const scenario of SCENARIOS) {
      await auditCheckoutScenario(browser, scenario);
    }
  } catch (globalErr) {
    console.error('Error global en la ejecución:', globalErr);
  } finally {
    await browser.close();
    console.log('🏁 Suite de auditoría completada.');
  }
})();