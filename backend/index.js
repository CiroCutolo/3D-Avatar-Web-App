import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import express, { raw } from "express";
import { promises as fs } from "fs";
import OpenAI from "openai";
import path from 'path';
import { fileURLToPath } from 'url';
import textToSpeech from '@google-cloud/text-to-speech';
import util from 'util';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Imposta la variabile d'ambiente per Google Cloud
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(__dirname, './cassandra3d-8bd2d35148a8.json');

// Ensure the /audios/ directory exists
const audioDir = path.join(__dirname, 'audios');
fs.mkdir(audioDir, { recursive: true }).catch(console.error);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "-", 
});

console.log("OpenAI API Key:", process.env.OPENAI_API_KEY);

const client = new textToSpeech.TextToSpeechClient();

const app = express();
app.use(express.json());
app.use(cors());
const port = 3000;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error("Error executing command:", error);
        reject(error);
      }
      resolve(stdout);
    });
  });
};

const lipSyncMessage = async (message) => {
  const time = new Date().getTime();
  console.log(`Starting conversion for message ${message}`);
  try {
    await execCommand(
      `ffmpeg -y -i audios/message_${message}.mp3 audios/message_${message}.wav`
    );
    console.log(`Conversion to WAV done in ${new Date().getTime() - time}ms`);
  } catch (error) {
    console.error(`Error converting to WAV: ${error.message}`);
    throw error;
  }

  try {
    await execCommand(
      `bin\\rhubarb -f json ./audios/message_${message}.wav -o ./audios/message_${message}.json -r phonetic`
    );
    console.log(`Lip sync done in ${new Date().getTime() - time}ms`);
  } catch (error) {
    console.error(`Error generating lip sync JSON: ${error.message}`);
    throw error;
  }
};

const googleTextToSpeech = async (fileName, text) => {
  const request = {
    input: { text: text },
    voice: { languageCode: "it-IT", name: "it-IT-Wavenet-A" },
    audioConfig: { audioEncoding: "MP3" },
  };

  try {
    const [response] = await client.synthesizeSpeech(request);
    await fs.writeFile(fileName, response.audioContent, 'binary');
    console.log(`Audio content written to file: ${fileName}`);
  } catch (error) {
    console.error(`Error generating audio file: ${error.message}`);
    throw error;
  }
};

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;
  if (!userMessage) {
    res.send({
      messages: [
        {
          text: "Ciao, sono Cassandra, sono stata creata dai dipendenti della Youbiquo e sarò la vostra guida.",
          audio: await audioFileToBase64("audios/Cassandra.ogg"),
          lipsync: await readJsonTranscript("audios/Cassandra.json"),
          facialExpression: "smile",
          animation: "Talking_1",
        },
      ],
    });
    return;
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo-1106",
    max_tokens: 1000,
    temperature: 0.6,
    messages: [
      {
        role: "system",
        content: `
        You are a virtual assistant. Always respond with a valid JSON array of messages.
        Each message should include the properties: text, facialExpression, and animation.
        Ensure the output is strictly valid JSON without any additional formatting or characters.
        `,
      },
      {
        role: "user",
        content: userMessage || "Hello",
      },
    ],
  });

  const rawMessage = completion.choices[0].message.content;
  console.log("Raw content:", rawMessage);

  const correctedMessages = rawMessage.replace(/```json|```/g, '').trim();
  console.log("Corrected content:", correctedMessages);

  let messages;

  try{
    messages = JSON.parse(correctedMessages);
  }catch (error) {
    console.error("Error parsing JSON:", error);
    return res.status(500).send({ error: "Invalid response from the API" });
  }

  if (messages.messages) {
    messages = messages.messages;
  }

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];  
    const fileName = `audios/message_${i}.mp3`;
    const textInput = message.text;

    try {
      await googleTextToSpeech(fileName, textInput);
      console.log(`Audio file created: ${fileName}`);
    } catch (error) {
      console.error(`Error generating audio file: ${error.message}`);
      continue;
    }

    try {
      await lipSyncMessage(i);
      console.log(`Lip sync JSON file created: audios/message_${i}.json`);
    } catch (error) {
      console.error(`Error generating lip sync JSON: ${error.message}`);
      continue;
    }

    message.audio = await audioFileToBase64(fileName);
    message.lipsync = await readJsonTranscript(`audios/message_${i}.json`);
  }

  res.send({ messages });
});

const readJsonTranscript = async (file) => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

const audioFileToBase64 = async (file) => {
  const data = await fs.readFile(file);
  return data.toString("base64");
};

app.listen(port, () => {
  console.log(`Virtual assistant listening on port ${port}`);
});
