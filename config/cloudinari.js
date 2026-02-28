const cloudinary = require('cloudinary').v2;
require('dotenv').config();


const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.cloud_name;
const apiKey = process.env.CLOUDINARY_API_KEY || process.env.api_key;
const apiSecret = process.env.CLOUDINARY_API_SECRET || process.env.api_secret;


const missingVars = [];
if (!cloudName) missingVars.push('CLOUDINARY_CLOUD_NAME or cloud_name');
if (!apiKey) missingVars.push('CLOUDINARY_API_KEY or api_key');
if (!apiSecret) missingVars.push('CLOUDINARY_API_SECRET or api_secret');

if (missingVars.length > 0) {
    console.error('Missing required Cloudinary environment variables:', missingVars);
    throw new Error(`Missing required Cloudinary environment variables: ${missingVars.join(', ')}`);
}


cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret
});


cloudinary.api.ping()
    .then(result => {
        console.log('Cloudinary configuration successful:', result);
    })
    .catch(error => {
        console.error('Cloudinary configuration failed:', error);
    });

module.exports = cloudinary; 