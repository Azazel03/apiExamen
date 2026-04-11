import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import sharp from 'sharp';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors()); // Permite todo por defecto durante las pruebas
app.use(express.json({ limit: '50mb' })); // Importante para que acepte el peso de la foto

app.listen(port, '0.0.0.0', () => {
    console.log(`Servidor corriendo en puerto ${port} y accesible en toda la red`);
});
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function sanitizeMedicalImage(base64String){
  //quitamos el prefijo data:image/jpeg;base64, si es que existe
  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, "")
  const imageBuffer = Buffer.from(base64Data, 'base64');

  try {
    const cleanImagenBuffer = await sharp(imageBuffer)
      .rotate() //Autocorrige la orientación según el EXIF antes de borrarlo
      .toBuffer(); //AL convertir a buffer sin indicar "withMetadata" se eliminan todos los EXIF

    return cleanImagenBuffer.toString('base64');  
  } catch (error) {
    console.error("Error limpiando metadatos:", error);
    throw new Error("No se pudo procesar la imagen para limpieza de seguridad.");
  }
}

app.get('/test', (req, res) => {
    console.log("¡Conexión de prueba exitosa!");
    res.send("OK");
});

app.post('/examen', async (req, res) => {
  const nameAPi = '/examen';
  const {base64Image} = req.body;
  console.log(nameAPi + ' request: ' + base64Image);
  if (!base64Image) {
    console.log(nameAPi + ' response: Faltan datos requeridos')
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }
  try {
    // --- CAPA DE PRIVACIDAD ---
    const cleanBase64 = await sanitizeMedicalImage(base64Image);
    // --------------------------

    // El prompt es la clave para que no se comporte como un médico rígido
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

    // Configuramos el modelo para que la respuesta sea un JSON válido
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" } 
    });

    // Convertimos el base64 para Gemini
    const imagePart = {
      inlineData: {
        data: cleanBase64,
        mimeType: "image/jpeg",
      },
    };

    const result = await model.generateContent([medicalPrompt, imagePart]);
    const responseText = result.response.text();
    const data = JSON.parse(responseText);

    // Validación: Si Gemini determinó que no es un examen
    if (!data.valido) {
      return res.status(422).json({
        success: false,
        message: data.error
      });
    }
    
    // Si es válido, enviamos la interpretación estructurada
    res.json({
      success: true,
      data: data
    });

  } catch (error) {
    console.error("Error procesando el examen:", error);
    res.status(500).send("Hubo un error al procesar la imagen.");
  }
});