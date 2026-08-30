import 'dotenv/config';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

console.log('--- Diagnóstico ---');
console.log('¿Token cargado?:', BOT_TOKEN ? 'Sí' : 'No');
console.log('¿Chat ID cargado?:', CHAT_ID ? 'Sí' : 'No');
console.log('-------------------');

async function sendTestMessage() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('❌ Falta configurar TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en el archivo .env');
    return;
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: '🚀 *¡Conexión Exitosa!*\n\nEl sistema de monitoreo para *Pinturerías Ámbito* ya está vinculado con este chat.',
        parse_mode: 'Markdown'
      })
    });

    const data = await response.json();
    if (data.ok) {
      console.log('✅ ¡Mensaje recibido en Telegram correctamente!');
    } else {
      console.error('❌ Telegram rechazó la petición:', data.description);
    }
  } catch (error) {
    console.error('❌ Detalle del error de conexión:', error.cause || error);
  }
}

sendTestMessage();