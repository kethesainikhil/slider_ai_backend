const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const OpenAI = require('openai');
const bodyParser = require('body-parser');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cheerio = require('cheerio');
const async = require('async');
require('dotenv').config()
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' })); 

app.use(express.json());

// Endpoint to fetch email details// Endpoint to fetch email details
app.get('/api/email-details', async (req, res) => {
  console.log("fetched email")
  try {
    const accessToken = req.headers['authorization']?.split(' ')[1]; // Extract access token from Authorization header
    const limit = req.query.limit || 15; // Default limit is 20 if not specified

    if (!accessToken) {
      return res.status(401).json({ error: 'Unauthorized: Access token missing' });
    }

    // Make the initial HTTP request to fetch email IDs
    const response = await axios.get('https://www.googleapis.com/gmail/v1/users/me/messages', {
      params: {
        labelIds: 'INBOX',
        maxResults: limit, // Use the specified limit
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const emailIds = response.data.messages.map(email => email.id);

    // Function to fetch email details by ID
    async function fetchEmailDetails(emailId) {

      try {
        const response = await axios.get(`https://www.googleapis.com/gmail/v1/users/me/messages/${emailId}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (!response || !response.data) {
          throw new Error('Response or response data is undefined.');
        }
        const { data } = response;
        const subject = data.payload.headers.find(header => header.name === 'Subject').value;
        const sender = data.payload.headers.find(header => header.name === 'From').value;
        const snippet  = data.snippet;
        let body = ''; // Initialize body as an empty string
        // Check if the email has body data
        if(data.payload.body.size > 0) {
          body = Buffer.from(data.payload.body?.data, 'base64').toString(); // Decode body from base64
        }
        else{
          if(data.payload.parts[0]?.body.size == 0){
            body = Buffer.from(data.payload.parts[0].parts[1].body.data, 'base64').toString();
           }
           if (data.payload.parts && data.payload.parts.length > 1 && data.payload.parts[1]?.body && data.payload.parts[1]?.body.data) {
              body = Buffer.from(data.payload.parts[1].body.data, 'base64').toString();
           }
   
           else if (data.payload.parts && data.payload.parts.length > 0 && data.payload.parts[0]?.body && data.payload.parts[0]?.body.data) {
              body = Buffer.from(data.payload.parts[0].body.data, 'base64').toString();
           }
           else{
            body = Buffer.from(data.payload.parts[0].parts[1].body.data,'base64').toString();
           }
        }
        // if (data.payload.parts && data.payload.parts.length > 0 && data.payload.parts[0].body && data.payload.parts[0].body.data) {
        //   body = Buffer.from(data.payload.parts[0].body.data, 'base64').toString(); // Decode body from base64
        // }
        return { emailId, subject, sender, snippet, body };
      } catch (error) {
        console.error('Error fetching email details:', error.response ? error.response.data : error.message);
        return null;
      }
    }

    // Fetch email details for each email ID
    const emailDetails = await Promise.all(emailIds.map(fetchEmailDetails));

    res.status(200).json(emailDetails.filter(detail => detail !== null));
  } catch (error) {
    console.error('Error fetching email details:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
// Endpoint to classify emails

 // HTML parsing library
 const batchSize = 10; // Define the batch size for processing emails

 app.post('/classify-emails', async (req, res) => {
  const apiKey = req.query.Google_Api_Key
  const genAI = new GoogleGenerativeAI(apiKey);
   try {
     const emails = req.body.emails;
     const categories = [
       "Important",
       "Promotions",
       "Spam",
       "Marketing",
       "Social",
       "General"
     ];
 
     const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
 
     const classifiedEmails = await batchProcessEmails(emails, categories, model);
 
     res.json(classifiedEmails);
   } catch (error) {
     console.error(error);
     res.status(500).json({ error: 'Internal server error' });
   }
 });
 
 async function batchProcessEmails(emails, categories, model) {
   const batches = splitArrayIntoChunks(emails, batchSize); // Split emails into batches
   const classifiedEmails = [];
   
   for (let i = 0; i < batches.length; i++) {
     const batchResults = await processBatch(batches[i], categories, model);
     classifiedEmails.push(...batchResults);
   }
 
   return classifiedEmails;
 }
 
 async function processBatch(emails, categories, model) {
   const results = await Promise.all(emails.map(async (email) => {
     try {
       const result = await classifyEmail(email, categories, model);
       return result;
     } catch (error) {
       console.error(`Error processing email ${email.emailId}:`, error);
       return { emailId: email.emailId, category: 'Error' };
     }
   }));
 
   return results;
 }
 
 async function classifyEmail(email, categories, model) {
   const prompt = `${JSON.stringify({ subject: email.subject, snippet: email.snippet, sender: email.sender, body: email.body })} \n\n classify the given email of having subject,snippet,sender,body  so use first look at the subject , body and then snippet  after that classify into one of the following categories: ${JSON.stringify(categories)} strictly follow this first look at the subject and then the body and snippet  thats all you need \n\n output: give me just the category `;
   const result = await model.generateContent(prompt);
   const response = await result.response;
   const text = await response.text();
   return { emailId: email.emailId, category: text.trim() };
 }
 
 function splitArrayIntoChunks(array, chunkSize) {
   const chunks = [];
   for (let i = 0; i < array.length; i += chunkSize) {
     chunks.push(array.slice(i, i + chunkSize));
   }
   return chunks;
 }
 app.post('/checkApiKey', async (req, res) => {
  const apiKey = req.query.Google_Api_Key

  try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      // Define a prompt to test the API key
      const prompt = "This is a test prompt to check if the API key works.";

      // Generate content using the model and the prompt
      const result = await model.generateContent(prompt);      
      if(result){
        res.json({ response:true });
      }
      // If the text contains the prompt, it means the API key is working

  } catch (error) {
      res.status(500).json({ response : false });
  }
});





// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
