// Función de Netlify: verifica el pago en Stripe y pide la explicación a Claude.
// Variables de entorno en Netlify: ANTHROPIC_API_KEY y STRIPE_SECRET_KEY

export default async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'Método no permitido' }, { status: 405 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'Datos inválidos' }, { status: 400 }); }

  const { session_id, datos, calculo } = body;
  if (!session_id || !datos || !calculo) return Response.json({ error: 'Faltan datos' }, { status: 400 });

  // 1) Verificar que sí pagó
  const stripeRes = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session_id)}`,
    { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } }
  );
  const sesion = await stripeRes.json();
  if (!stripeRes.ok || sesion.payment_status !== 'paid') {
    return Response.json({ error: 'No encontramos tu pago' }, { status: 402 });
  }

  // 2) Pedir explicación a Claude
  const f = n => '$' + Number(n).toFixed(2);
  const resumen = `
Trabajo: ${datos.tipo === 'agricola' ? 'invernadero/campo/granja' : 'fábrica/almacén/otro'}
Pago: ${datos.frecuencia === 26 ? 'cada 2 semanas' : 'cada semana'}
Tarifa por hora: ${f(datos.tarifa)}
Horas por semana: ${datos.horas.join(' y ')}
Vacaciones 4% en cada cheque: ${datos.vacaciones ? 'sí' : 'no'}

Cálculo estimado:
- Horas normales: ${calculo.hReg} = ${f(calculo.regular)}
- Tiempo extra: ${calculo.hExtra} h = ${f(calculo.extra)}
- Vacaciones: ${f(calculo.vac)}
- Bruto: ${f(calculo.bruto)}
- CPP: ${f(calculo.cpp)} | EI: ${f(calculo.ei)} | Impuestos aprox: ${f(calculo.impuestos)}
- Neto estimado: ${f(calculo.neto)}
Neto real que recibió: ${datos.netoReal ? f(datos.netoReal) : 'no lo dijo'}`;

  const system = `Eres un asistente de Lolo Digital que explica cheques de pago a trabajadores latinos en Ontario, Canadá.
Habla en español mexicano casual, cálido y claro, como un compa que sabe del tema. Frases cortas. Sin tecnicismos o, si usas uno, explícalo.
Datos 2026: salario mínimo general Ontario $17.95/h desde 1 oct 2026; CPP 5.95%; EI 1.63%. En Ontario el tiempo extra es 1.5x después de 44 h/semana, pero muchos trabajadores agrícolas están exentos salvo que su contrato diga otra cosa. Los trabajadores del programa SAWP o con permiso temporal tienen contrato propio que puede fijar su salario y descuentos (vivienda, transporte, etc.).
Estructura tu respuesta así (máx. 250 palabras, sin markdown con asteriscos ni #, usa emojis como viñetas):
1. Qué significa cada descuento de su cheque, en una línea cada uno.
2. Si su cheque se ve normal o no, y por qué.
3. Qué revisar en su talón (pay stub) y qué preguntarle al patrón o agencia.
4. Si algo no cuadra: Employment Standards Ontario 1-800-531-5551 (hay intérpretes), o para impuestos la CRA.
Aclara al final, en una frase, que es una estimación y no asesoría legal. Nunca inventes leyes ni cifras que no estén aquí.`;

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      system,
      messages: [{ role: 'user', content: `Explícame mi cheque:\n${resumen}` }]
    })
  });
  const data = await claudeRes.json();
  if (!claudeRes.ok) return Response.json({ error: 'La IA no respondió, intenta otra vez' }, { status: 502 });

  const texto = data.content?.find(b => b.type === 'text')?.text || 'No se pudo generar la explicación.';
  return Response.json({ texto });
};
