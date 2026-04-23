import express from 'express';
import sharp from 'sharp';
import dotenv from 'dotenv';
import cors from 'cors';
import fetch from 'node-fetch';

dotenv.config();

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

/**
 * CAPA DE PRIVACIDAD
 * Limpia metadatos y corrige orientación
 */
async function sanitizeMedicalImage(base64String) {
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer = Buffer.from(base64Data, 'base64');

    try {
        const cleanImagenBuffer = await sharp(imageBuffer)
            .rotate()
            .toBuffer();

        return cleanImagenBuffer.toString('base64');
    } catch (error) {
        console.error("Error limpiando metadatos:", error);
        throw new Error("No se pudo procesar la imagen para limpieza de seguridad.");
    }
}

app.get('/test', (req, res) => {
    res.send("Servidor de Exámenes Médico Activo - Conexión Directa");
});

app.post('/examen', async (req, res) => {
    const { base64Image } = req.body;

    if (!base64Image) {
        return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    try {
        const cleanBase64 = await sanitizeMedicalImage(base64Image);

        const medicalPrompt  = `
          Eres un asistente virtual especializado en salud para el público en Chile. Tu tarea es analizar imágenes de exámenes médicos y explicar los resultados de forma sencilla.

          ### 1. VALIDACIÓN INICIAL (CRÍTICO)
          Analiza si la imagen es efectivamente un documento médico (Hemograma, Perfil Bioquímico, Orina, Imágenes, Recetas, etc.).
          - Si la imagen NO es un examen médico o no es legible, responde únicamente: 
            {"valido": false, "error": "El archivo subido no parece ser un examen médico legible. Por favor, intenta con una foto más clara."}

          ### 2. CONTEXTO CHILENO
          - Identifica si el examen pertenece a instituciones como RedSalud, UC Christus, Bupa, Integramédica, Clínica Alemana, o laboratorios locales.
          - Usa lenguaje cercano pero profesional (evita modismos excesivos, usa español neutro de Chile).

          ### 3. REGLAS DE INTERPRETACIÓN
          - Explica los términos técnicos como si le hablaras a alguien de 12 años (ej: en lugar de "Leucocitosis", di "Glóbulos blancos altos, que suelen indicar una defensa del cuerpo").
          - Compara los valores con los "Rangos de Referencia" presentes en la foto.
          - Si hay valores fuera de rango, menciónalos con calma, sin alarmar.

          ### 4. FORMATO DE SALIDA (ESTRICTO JSON)
          Debes responder exclusivamente en este formato JSON para que mi API pueda procesarlo:

          {
            "valido": true,
            "tipo_examen": "Nombre del examen (ej: Hemograma Completo)",
            "institucion": "Nombre del laboratorio o clínica (si se detecta)",
            "disclaimer": "IMPORTANTE: Este análisis es generado por IA y NO es un diagnóstico médico. Debes consultar estos resultados con un profesional de la salud. Información válida para el contexto de salud en Chile.",
            "estado_general": "Resumen de una oración sobre si los valores están mayormente normales o alterados.",
            "detalles": [
              {
                "item": "Nombre del parámetro (ej: Glucosa)",
                "valor": "Valor numérico con su unidad (ej: 110 mg/dL)",
                "rango": "Rango de referencia del laboratorio",
                "estado": "Normal / Alto / Bajo",
                "explicacion_simple": "Explicación breve de qué es esto y por qué importa."
              }
            ],
            "sugerencia": "Recomendación de qué especialista ver (ej: Medicina General, Nutricionista, etc.)."
          }
        `;

        /**
         * SOLUCIÓN AL ERROR 404:
         * Cambiamos de 'v1beta' a 'v1' (Estable).
         * Google Cloud en regiones de Datacenters suele preferir la ruta estable de producción.
         */
        const apiKey = process.env.GEMINI_API_KEY;
        //const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{
                parts: [
                    { text: medicalPrompt },
                    {
                        inline_data: {
                            mime_type: "image/jpeg",
                            data: cleanBase64
                        }
                    }
                ]
            }],
            generationConfig: {
                temperature: 0.1, // Reducimos temperatura para mayor precisión médica
                response_mime_type: "application/json"
            }
        };

        const apiResponse = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await apiResponse.json();

        if (!apiResponse.ok) {
            console.error("Error de API Google (Detalle):", JSON.stringify(result, null, 2));
            throw new Error(result.error?.message || "Error en la comunicación con la API de producción.");
        }

        // Validación de la estructura de respuesta de Google V1
        if (!result.candidates || !result.candidates[0]?.content?.parts?.[0]?.text) {
            throw new Error("La IA no devolvió contenido válido.");
        }

        let responseText = result.candidates[0].content.parts[0].text;
        
        // Limpieza de posibles tags de markdown que la IA incluya a pesar del prompt
        responseText = responseText.replace(/```json|```/g, "").trim();
        
        const data = JSON.parse(responseText);

        if (data.valido === false) {
            return res.status(422).json({
                success: false,
                message: data.error
            });
        }

        res.json({
            success: true,
            data: data
        });

    } catch (error) {
        console.error("Error crítico en backend:", error.message);
        res.status(500).json({
            success: false,
            message: "Error al procesar el examen médico",
            details: error.message
        });
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Servidor escuchando en puerto ${port}`);
});