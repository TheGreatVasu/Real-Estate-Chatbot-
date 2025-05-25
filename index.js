import express from "express";
import bodyParser from "body-parser";
import { HfInference } from '@huggingface/inference';
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import cors from "cors";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import session from "express-session";
import fs from "fs";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

// Setup __dirname for ES modules compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Local storage path for data (compatible with all platforms)
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHAT_HISTORY_FILE = path.join(DATA_DIR, 'chat_history.json');

// Create data directory if it doesn't exist
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize local storage files if they don't exist
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([]));
}

if (!fs.existsSync(CHAT_HISTORY_FILE)) {
    fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify([]));
}

// Helper functions for file-based storage
const readUsers = () => {
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading users file:', error);
        return [];
    }
};

const writeUsers = (users) => {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing users file:', error);
        return false;
    }
};

const readChatHistory = () => {
    try {
        const data = fs.readFileSync(CHAT_HISTORY_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading chat history file:', error);
        return [];
    }
};

const writeChatHistory = (history) => {
    try {
        fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify(history, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing chat history file:', error);
        return false;
    }
};

// Middleware
app.use(cors({
  origin: '*', // Allow all origins temporarily for testing
  credentials: true
}));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(session({
  secret: JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours, secure:false for development
}));
app.use(express.static(path.join(__dirname, 'public')));

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const token = req.cookies.token || req.headers['x-access-token'];

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('JWT verification failed:', error.message);
    req.user = null;
    next();
  }
};

// Apply authentication middleware to all routes
app.use(authenticateToken);

// Hugging Face Setup
const hf = new HfInference(process.env.HUGGING_FACE_TOKEN);

// Indian cities property price data (price per sq ft in INR)
const cityPriceData = {
    // Tier 1 Cities
    'mumbai': {
        basePrice: 25000,
        premium: ['bandra', 'juhu', 'worli', 'colaba'],
        premiumMultiplier: 2.5,
        areas: {
            'bandra': 45000,
            'juhu': 50000,
            'worli': 48000,
            'colaba': 47000,
            'andheri': 25000,
            'thane': 15000,
            'navi mumbai': 12000
        }
    },
    'delhi': {
        basePrice: 15000,
        premium: ['south delhi', 'delhi ncr', 'dwarka'],
        premiumMultiplier: 2,
        areas: {
            'south delhi': 30000,
            'delhi ncr': 25000,
            'dwarka': 12000,
            'rohini': 10000,
            'mayur vihar': 11000
        }
    },
    'bangalore': {
        basePrice: 12000,
        premium: ['indiranagar', 'koramangala', 'whitefield'],
        premiumMultiplier: 1.8,
        areas: {
            'indiranagar': 18000,
            'koramangala': 20000,
            'whitefield': 15000,
            'electronic city': 8000,
            'marathahalli': 10000
        }
    },

    // Tier 2 Cities
    'pune': {
        basePrice: 8000,
        premium: ['koregaon park', 'kalyani nagar'],
        premiumMultiplier: 1.6,
        areas: {
            'koregaon park': 15000,
            'kalyani nagar': 14000,
            'hinjewadi': 7500,
            'wakad': 7000
        }
    },
    'hyderabad': {
        basePrice: 7000,
        premium: ['banjara hills', 'jubilee hills'],
        premiumMultiplier: 1.7,
        areas: {
            'banjara hills': 12000,
            'jubilee hills': 13000,
            'gachibowli': 8000,
            'madhapur': 7500
        }
    },
    'chennai': {
        basePrice: 9000,
        premium: ['boat club', 'adyar'],
        premiumMultiplier: 1.8,
        areas: {
            'boat club': 18000,
            'adyar': 15000,
            'velachery': 8000,
            'omr': 7000
        }
    },

    // Tier 3 Cities
    'ahmedabad': {
        basePrice: 5500,
        premium: ['bodakdev', 'satellite'],
        premiumMultiplier: 1.5,
        areas: {
            'bodakdev': 8000,
            'satellite': 7500,
            'bopal': 5000,
            'sg highway': 6000
        }
    },
    'kolkata': {
        basePrice: 6000,
        premium: ['ballygunge', 'alipore'],
        premiumMultiplier: 1.6,
        areas: {
            'ballygunge': 12000,
            'alipore': 11000,
            'rajarhat': 5500,
            'salt lake': 6500
        }
    }
};

// Function to get base price for location
function getLocationPrice(location) {
    const locationLower = location.toLowerCase();
    
    // Check for exact city or area match
    for (const city in cityPriceData) {
        if (locationLower.includes(city)) {
            // Check if it's a specific area within the city
            const cityData = cityPriceData[city];
            for (const area in cityData.areas) {
                if (locationLower.includes(area)) {
                    return cityData.areas[area];
                }
            }
            // If no specific area found, return city base price
            return cityData.basePrice;
        }
    }
    
    // Default price if city not found
    return 8000; // Default price per sq ft
}

// Function to predict property value
async function predictPropertyValue(propertyDetails) {
    try {
        const basePrice = getLocationPrice(propertyDetails.location);
        const squareFootage = propertyDetails.squareFootage;
        
        // Base calculation
        let estimatedPrice = basePrice * squareFootage;
        
        // Adjustments based on property features
        if (propertyDetails.bedrooms) {
            estimatedPrice += propertyDetails.bedrooms * 500000; // Add 5 lakhs per bedroom
        }
        
        if (propertyDetails.bathrooms) {
            estimatedPrice += propertyDetails.bathrooms * 300000; // Add 3 lakhs per bathroom
        }
        
        // Age adjustment
        if (propertyDetails.yearBuilt) {
            const currentYear = new Date().getFullYear();
            const age = currentYear - propertyDetails.yearBuilt;
            if (age <= 2) {
                estimatedPrice *= 1.2; // 20% premium for new construction
            } else if (age > 20) {
                estimatedPrice *= 0.8; // 20% reduction for old construction
            }
        }
        
        // Additional features adjustment
        if (propertyDetails.additionalFeatures) {
            const features = propertyDetails.additionalFeatures.toLowerCase();
            if (features.includes('parking')) estimatedPrice += 200000;
            if (features.includes('garden') || features.includes('terrace')) estimatedPrice += 500000;
            if (features.includes('gym') || features.includes('swimming')) estimatedPrice += 1000000;
            if (features.includes('furnished')) estimatedPrice += 1500000;
        }

        return Math.round(estimatedPrice);
    } catch (error) {
        console.error('Error predicting property value:', error);
        throw error;
    }
}

// Helper function to generate dynamic responses
function generateResponse(message, propertyDetails) {
    // Check if message is empty or null
    if (!message || message.trim() === '') {
        return "I didn't receive a message. How can I help you with real estate in India today?";
    }
    
    // Check for simple greetings
    const messageLower = message.toLowerCase().trim();
    if (['hi', 'hello', 'hey', 'hola', 'namaste', 'greetings'].includes(messageLower)) {
        return "👋 Hello! How can I help you with your real estate queries today?";
    }
    
    // Check if message is off-topic
    if (isOffTopic(message)) {
        return "I apologize, but I'm specialized in Indian real estate topics only. I can help you with:\n\n" +
               "• Property valuations and price estimates\n" +
               "• Investment opportunities in Indian cities\n" +
               "• Market trends and analysis\n" +
               "• Financing and loan options\n" +
               "• Legal aspects of real estate\n\n" +
               "Please feel free to ask about any of these topics!";
    }

    // Check if it's a number for menu selection (1-8)
    const numberMatch = message.match(/^[1-8]$/);
    if (numberMatch) {
        return handleNumericResponse(parseInt(numberMatch[0]));
    }
    
    // Check for heading matches (Property Valuation, Property Search, etc.)
    const headings = {
        "property valuation": 1,
        "property search": 2,
        "financial guidance": 3,
        "legal information": 4
    };
    
    for (const [heading, number] of Object.entries(headings)) {
        if (messageLower === heading || messageLower.includes(heading)) {
            return handleNumericResponse(number);
        }
    }
    
    // Check for city-specific investment queries
    const cityInvestmentMatch = message.match(/(?:invest|investment|property|properties|buy|opportunities).*(?:in|at)\s+(\w+)/i);
    if (cityInvestmentMatch) {
        const city = cityInvestmentMatch[1].toLowerCase();
        const majorCities = ['mumbai', 'delhi', 'bangalore', 'hyderabad', 'kolkata', 'chennai', 'pune'];
        if (majorCities.includes(city)) {
            return generateCityInvestmentResponse(city);
        }
    }
    
    // Direct city name mentions
    const cityMention = message.match(/\b(mumbai|delhi|bangalore|hyderabad|kolkata|chennai|pune)\b/i);
    if (cityMention && message.length < 20) {
        return generateCityInvestmentResponse(cityMention[1]);
    }

    // Define categories for classification
    const categories = {
        property_valuation: /(?:value|valuation|price|worth|estimate|cost|what is the price of|how much is|how much would|what would it cost)/i,
        market_trends: /(?:trend|growth|appreciation|increase|decrease|market|statistics|data|reports?|analytics|research|study|projection)/i,
        property_features: /(?:features?|amenities|facility|service|specification|include|furnish|appliance|what does it have|what is included|what comes with)/i,
        investment_advice: /(?:invest|roi|return|yield|profit|appreciation|growth|potential|opportunity|portfolio|diversify|strategy|plan)/i,
        property_type: /(?:type|category|kind|style|apartment|flat|house|villa|plot|land|commercial|residential|office|retail|warehouse|industrial)/i,
        financing: /(?:loan|mortgage|finance|payment|emi|interest|down payment|installment|credit|bank|lend|borrow)/i,
        legal: /(?:legal|document|registration|stamp duty|agreement|contract|tax|compliance|regulation|law|permit|approval|license|NOC|certificate)/i,
        locations: /(?:location|area|place|neighborhood|locality|region|zone|sector|where|which place|which area)/i
    };

    // Check if message matches any category
    let response = "";
    
    if (categories.property_valuation.test(message)) {
        response = "💰 *Property Valuation*\n\n";
        response += "*Factors Affecting Value:*\n";
        response += "━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
        response += "1️⃣ *Location*\n";
        response += "   • City tier\n";
        response += "   • Neighborhood\n";
        response += "   • Proximity to amenities\n";
        response += "   • Connectivity\n\n";
        response += "2️⃣ *Property Specifications*\n";
        response += "   • Built-up area\n";
        response += "   • Bedrooms/bathrooms\n";
        response += "   • Floor number\n";
        response += "   • Age of construction\n\n";
        response += "3️⃣ *Additional Features*\n";
        response += "   • Parking availability\n";
        response += "   • Security systems\n";
        response += "   • Amenities (gym, pool, etc.)\n";
        response += "   • Furnishing status\n\n";
        response += "4️⃣ *Market Factors*\n";
        response += "   • Current demand\n";
        response += "   • Supply in the area\n";
        response += "   • Recent transactions\n";
        response += "   • Future development plans\n\n";
        response += "To get an accurate valuation, please provide property details using the form.";
    } else if (categories.market_trends.test(message)) {
        response = "📊 *Indian Real Estate Market Trends*\n\n";
        response += "*Current Insights:*\n";
        response += "━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
        response += "1️⃣ *Market Overview*\n";
        response += "   • Residential sector: Growing at 9.5% YoY\n";
        response += "   • Commercial sector: Stable with 7% YoY growth\n";
        response += "   • Affordable housing: High demand in Tier 2 cities\n";
        response += "   • Luxury segment: Recovering in metro cities\n\n";
        response += "2️⃣ *City-wise Growth*\n";
        response += "   • Hyderabad: +14.3%\n";
        response += "   • Bengaluru: +11.8%\n";
        response += "   • Pune: +9.6%\n";
        response += "   • Mumbai: +8.2%\n";
        response += "   • Delhi-NCR: +7.4%\n\n";
        response += "3️⃣ *Key Drivers*\n";
        response += "   • Infrastructure development\n";
        response += "   • Remote work policies\n";
        response += "   • Foreign investment\n";
        response += "   • Government initiatives\n\n";
        response += "4️⃣ *2025 Projections*\n";
        response += "   • Residential prices: +12-15%\n";
        response += "   • Commercial yields: 7-9%\n";
        response += "   • Rental market: +8-10%\n";
        response += "   • NRI investments: +20%\n\n";
        response += "💡 *Recent Trends:*\n";
        response += "• Post-pandemic recovery: +15%\n";
        response += "• Rental market growth: +8%\n";
        response += "• Commercial revival: +12%\n\n";
        response += "Please specify your investment criteria for detailed market analysis.";
    } else if (categories.property_features.test(message)) {
        response = "🏗️ *Property Features & Amenities*\n\n";
        response += "*Key Value Factors:*\n";
        response += "━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
        response += "1️⃣ *Location Advantages*\n";
        response += "   • Metro/railway connectivity\n";
        response += "   • School and hospital proximity\n";
        response += "   • Shopping and entertainment\n";
        response += "   • Road connectivity\n\n";
        response += "2️⃣ *Property Specifications*\n";
        response += "   • Total built-up area\n";
        response += "   • Bedrooms and bathrooms\n";
        response += "   • Floor number and view\n";
        response += "   • Age and condition\n\n";
        response += "3️⃣ *Modern Amenities*\n";
        response += "   • Parking (covered/open)\n";
        response += "   • Power backup\n";
        response += "   • Security system\n";
        response += "   • Clubhouse facilities\n\n";
        response += "4️⃣ *Premium Features*\n";
        response += "   • Modular kitchen\n";
        response += "   • Smart home features\n";
        response += "   • Garden/balcony\n";
        response += "   • Furnishing status\n\n";
        response += "💡 *Value Impact:*\n";
        response += "• Each premium feature: +2-5%\n";
        response += "• Modern amenities: +5-10%\n";
        response += "• Location benefits: +10-15%\n\n";
        response += "Which features are most important to you?";
    } else if (categories.investment_advice.test(message)) {
        response = "💼 *Real Estate Investment Guide*\n\n";
        response += "*Investment Options:*\n";
        response += "━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
        response += "1️⃣ *Property Types*\n";
        response += "   • Residential properties\n";
        response += "   • Commercial spaces\n";
        response += "   • Plots/Land\n";
        response += "   • REITs\n\n";
        response += "2️⃣ *Key Metrics*\n";
        response += "   • Location growth potential\n";
        response += "   • Rental yield (2-4%)\n";
        response += "   • Capital appreciation\n";
        response += "   • Property management\n\n";
        response += "3️⃣ *Financial Planning*\n";
        response += "   • Down payment (20-30%)\n";
        response += "   • Home loan options\n";
        response += "   • Property taxes\n";
        response += "   • Maintenance costs\n\n";
        response += "4️⃣ *Risk Assessment*\n";
        response += "   • Market fluctuations\n";
        response += "   • Legal issues\n";
        response += "   • Maintenance challenges\n";
        response += "   • Tenant management\n\n";
        response += "💡 *Investment Tips:*\n";
        response += "• Diversify across locations\n";
        response += "• Consider rental potential\n";
        response += "• Factor in maintenance costs\n";
        response += "• Plan for long-term growth\n\n";
        response += "What type of investment interests you?";
    } else if (categories.property_type.test(message)) {
        response = "🏘️ *Property Types & Categories*\n\n";
        response += "*Available Options:*\n";
        response += "━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
        response += "1️⃣ *Residential Properties*\n";
        response += "   • Apartments/Flats\n";
        response += "   • Independent Houses\n";
        response += "   • Villas/Bungalows\n";
        response += "   • Penthouses\n\n";
        response += "2️⃣ *Commercial Properties*\n";
        response += "   • Office Spaces\n";
        response += "   • Retail Shops\n";
        response += "   • Warehouses\n";
        response += "   • Showrooms\n\n";
        response += "3️⃣ *Land/Plots*\n";
        response += "   • Residential Plots\n";
        response += "   • Commercial Plots\n";
        response += "   • Agricultural Land\n\n";
        response += "4️⃣ *Special Properties*\n";
        response += "   • Farmhouses\n";
        response += "   • Holiday Homes\n";
        response += "   • Industrial Units\n\n";
        response += "💡 *Selection Guide:*\n";
        response += "• Residential: Best for first-time buyers\n";
        response += "• Commercial: Higher rental yields\n";
        response += "• Land: Long-term appreciation\n";
        response += "• Special: Unique investment opportunities\n\n";
        response += "Which property type interests you?";
    } else if (categories.financing.test(message)) {
        response = "💳 *Real Estate Financing Guide*\n\n";
        response += "*Loan Options:*\n";
        response += "━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
        response += "1️⃣ *Home Loans*\n";
        response += "   • Interest rates: 6.5-8.5%\n";
        response += "   • Tenure: up to 30 years\n";
        response += "   • Down payment: 20-30%\n";
        response += "   • EMI calculator available\n\n";
        response += "2️⃣ *Lending Institutions*\n";
        response += "   • Public sector banks\n";
        response += "   • Private sector banks\n";
        response += "   • Housing finance companies\n\n";
        response += "3️⃣ *Additional Costs*\n";
        response += "   • Registration charges\n";
        response += "   • Stamp duty\n";
        response += "   • Property tax\n";
        response += "   • Maintenance charges\n\n";
        response += "4️⃣ *Tax Benefits*\n";
        response += "   • Home loan interest deduction\n";
        response += "   • Principal repayment deduction\n";
        response += "   • Property tax deduction\n\n";
        response += "💡 *Financial Tips:*\n";
        response += "• Compare multiple lenders\n";
        response += "• Consider pre-EMI options\n";
        response += "• Factor in all costs\n";
        response += "• Plan for long-term EMI\n\n";
        response += "Would you like specific loan details for your budget?";
    } else if (categories.legal.test(message)) {
        response = "⚖️ *Legal Aspects of Real Estate*\n\n";
        response += "*Essential Information:*\n";
        response += "━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
        response += "1️⃣ *Required Documents*\n";
        response += "   • Sale deed\n";
        response += "   • Property tax receipts\n";
        response += "   • Building approval plans\n";
        response += "   • NOC from authorities\n\n";
        response += "2️⃣ *Verification Process*\n";
        response += "   • Title verification\n";
        response += "   • Encumbrance certificate\n";
        response += "   • Property tax clearance\n";
        response += "   • Building compliance\n\n";
        response += "3️⃣ *Registration Steps*\n";
        response += "   • Stamp duty payment\n";
        response += "   • Document registration\n";
        response += "   • Mutation entry\n\n";
        response += "4️⃣ *Society/Association*\n";
        response += "   • Maintenance charges\n";
        response += "   • Society rules\n";
        response += "   • Common area rights\n\n";
        response += "💡 *Legal Tips:*\n";
        response += "• Always verify documents\n";
        response += "• Check property history\n";
        response += "• Understand local laws\n";
        response += "• Keep records updated\n\n";
        response += "Which legal aspect would you like to know more about?";
    } else if (categories.locations.test(message)) {
        response = "📍 *Real Estate Locations Guide*\n\n";
        response += "*Popular Cities:*\n";
        response += "━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
        response += "1️⃣ *Tier 1 Cities*\n";
        response += "   • Mumbai: ₹15,000-35,000/sqft\n";
        response += "   • Delhi NCR: ₹8,000-25,000/sqft\n";
        response += "   • Bangalore: ₹6,000-18,000/sqft\n";
        response += "   • Hyderabad: ₹5,000-12,000/sqft\n\n";
        response += "2️⃣ *Tier 2 Cities*\n";
        response += "   • Pune: ₹5,500-12,000/sqft\n";
        response += "   • Ahmedabad: ₹3,500-8,000/sqft\n";
        response += "   • Jaipur: ₹3,200-7,500/sqft\n";
        response += "   • Lucknow: ₹3,000-6,500/sqft\n\n";
        response += "3️⃣ *Emerging Markets*\n";
        response += "   • Kochi: ₹4,500-9,000/sqft\n";
        response += "   • Bhubaneswar: ₹3,200-6,500/sqft\n";
        response += "   • Indore: ₹3,000-6,000/sqft\n";
        response += "   • Coimbatore: ₹3,800-7,500/sqft\n\n";
        response += "4️⃣ *Location Selection Factors*\n";
        response += "   • Infrastructure development\n";
        response += "   • Employment opportunities\n";
        response += "   • Lifestyle amenities\n";
        response += "   • Future growth projections\n\n";
        response += "Which location would you like to know more about?";
    } else {
        // Default response (not a specific category or command)
        response = "I'm not sure what you're asking about. Could you please provide more details about your real estate query?";
    }

    return response;
}

// Handle numeric responses
function handleNumericResponse(number) {
    switch(number) {
        case 1:
            return "💰 *Property Valuation*\n\nPlease provide:\n1. Location\n2. Square footage\n3. Bedrooms/bathrooms\n4. Year built\n5. Additional features\n\nYou can enter these details in the form on the right, or describe the property you're interested in evaluating.";
        case 2:
            return "🏠 *Property Search*\n\nTo help you find the perfect property, please tell me:\n\n1. Which city are you interested in?\n2. What type of property are you looking for?\n3. Do you have a specific budget in mind?\n4. Any particular features or amenities you need?\n\nI can provide insights on different locations, property types, and help compare features.";
        case 3:
            return "💳 *Financial Guidance*\n\nI can help with real estate financial planning. Please specify:\n\n1. Your budget or loan amount needed\n2. Preferred down payment percentage\n3. Loan tenure preference (5-30 years)\n4. Monthly income (for EMI calculation)\n\nI can provide information on loan options, EMI calculations, and investment ROI analysis.";
        case 4:
            return "⚖️ *Legal Information*\n\nTo help with legal aspects of real estate, I can provide information on:\n\n1. Documentation required for property purchase/sale\n2. Registration process and stamp duty\n3. Compliance requirements\n4. Legal due diligence\n\nWhich specific legal aspect of real estate transactions would you like to know more about?";
        case 5:
            return "📊 *Market Trends*\n\nI can provide the latest real estate market trends and analysis. What would you like to know about?\n\n1. City-specific market trends\n2. Segment performance (residential/commercial)\n3. Investment hotspots\n4. Future projections\n\nSpecify a city or region for detailed market insights.";
        case 6:
            return "🏢 *Property Types*\n\nI can provide information on different property types:\n\n1. Residential properties (apartments, villas, independent houses)\n2. Commercial properties (office spaces, retail, warehouses)\n3. Land/plots\n4. Special purpose properties\n\nWhich property type are you interested in learning more about?";
        case 7:
            return "🏗️ *Property Features*\n\nI can help you understand how different features affect property value:\n\n1. Location advantages\n2. Size and layout considerations\n3. Amenities and facilities\n4. Construction quality and specifications\n\nWhich aspects are most important for your property considerations?";
        case 8:
            return "📱 *Contact Support*\n\n*Get in touch with our real estate expert:*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n📞 Phone: +91 8859985607\n📧 Email: vasurastogi213@gmail.com\n\nAvailable for:\n• Property consultations\n• Market insights\n• Investment guidance\n• Site visits\n\n⏰ *Available Hours:*\nMon-Sat: 9:00 AM - 7:00 PM IST\n\nFor immediate assistance:\n• Call/WhatsApp: +91 8859985607\n• Email for detailed queries\n• Response time: Within 2 hours";
        default:
            return "Please enter a number between 1 and 8 for specific information.";
    }
}

// Check if query is off-topic
function isOffTopic(message) {
    // List of real estate related keywords
    const realEstateKeywords = [
        'property', 'house', 'apartment', 'flat', 'villa', 'real estate', 'home', 
        'buy', 'rent', 'sell', 'price', 'valuation', 'loan', 'mortgage', 'emi', 
        'location', 'area', 'city', 'market', 'investment', 'commercial', 
        'residential', 'land', 'plot', 'construction', 'builder', 'broker', 
        'agent', 'bedroom', 'bathroom', 'square foot', 'sqft', 'amenities', 
        'feature', 'floor', 'society', 'registration', 'legal', 'document', 
        'stamp duty', 'property tax', 'reit', 'capital gain', 'rate', 'return',
        'mumbai', 'delhi', 'bangalore', 'hyderabad', 'chennai', 'kolkata',
        'pune', 'ahmedabad', 'jaipur', 'lucknow', 'kochi', 'chandigarh',
        'gurgaon', 'noida', 'goa', 'indore', 'bhubaneswar', 'coimbatore'
    ];
    
    // Convert message to lowercase for case-insensitive matching
    const lowerMessage = message.toLowerCase();
    
    // Check if any real estate keyword is found in the message
    const containsRealEstateTerms = realEstateKeywords.some(keyword => 
        lowerMessage.includes(keyword)
    );
    
    // If message is very short (< 4 words) don't mark as off-topic
    // as it could be simple queries like "hi" or "help"
    const wordCount = lowerMessage.split(/\s+/).length;
    if (wordCount < 4) {
        return false;
    }
    
    return !containsRealEstateTerms;
}

// Handle city-specific investment queries
function generateCityInvestmentResponse(city) {
    const cityData = {
        'mumbai': {
            areas: ['Bandra', 'Worli', 'Andheri', 'Powai', 'Navi Mumbai'],
            returns: '8-12%',
            growth: 'High',
            properties: 'Premium residential and commercial spaces'
        },
        'delhi': {
            areas: ['South Delhi', 'Dwarka', 'Noida Extension', 'Gurgaon', 'Greater Noida'],
            returns: '7-10%',
            growth: 'Moderate to High',
            properties: 'Residential plots and luxury apartments'
        },
        'bangalore': {
            areas: ['Whitefield', 'Electronic City', 'Hebbal', 'Sarjapur Road', 'Yelahanka'],
            returns: '8-14%',
            growth: 'Very High',
            properties: 'Tech-hub adjacent residential and office spaces'
        },
        'hyderabad': {
            areas: ['Gachibowli', 'HITEC City', 'Kondapur', 'Kukatpally', 'Manikonda'],
            returns: '9-15%',
            growth: 'Very High',
            properties: 'IT corridor properties and gated communities'
        },
        'kolkata': {
            areas: ['New Town', 'Salt Lake', 'Rajarhat', 'Ballygunge', 'Alipore'],
            returns: '6-9%',
            growth: 'Moderate',
            properties: 'Mixed residential and developing commercial areas'
        },
        'chennai': {
            areas: ['OMR', 'ECR', 'Porur', 'Sholinganallur', 'Siruseri'],
            returns: '7-11%',
            growth: 'Moderate to High',
            properties: 'IT corridor apartments and beach-side properties'
        },
        'pune': {
            areas: ['Kharadi', 'Hinjewadi', 'Baner', 'Wakad', 'Kothrud'],
            returns: '8-12%',
            growth: 'High',
            properties: 'Tech-park adjacent properties and township projects'
        }
    };
    
    const cityInfo = cityData[city.toLowerCase()] || {
        areas: ['Prime localities', 'Developing areas'],
        returns: '7-10%',
        growth: 'Varies by location',
        properties: 'Mixed residential and commercial'
    };
    
    return `🏢 *Investment Opportunities in ${city.charAt(0).toUpperCase() + city.slice(1)}*\n\n` +
           `*Top Areas for Investment:*\n` +
           `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
           `1️⃣ *High-Potential Locations*\n` +
           cityInfo.areas.map(area => `   • ${area}\n`).join('') +
           `\n2️⃣ *Investment Returns*\n` +
           `   • Expected ROI: ${cityInfo.returns}\n` +
           `   • Growth potential: ${cityInfo.growth}\n` +
           `   • Current trends: Positive\n\n` +
           `3️⃣ *Recommended Properties*\n` +
           `   • ${cityInfo.properties}\n\n` +
           `4️⃣ *Budget Recommendations*\n` +
           `   • Entry level: ₹40L - ₹80L\n` +
           `   • Mid-range: ₹80L - ₹1.5Cr\n` +
           `   • Premium: ₹1.5Cr+\n\n` +
           `💡 *Investment Tips:*\n` +
           `• Look for infrastructure development plans\n` +
           `• Consider connectivity and amenities\n` +
           `• Research builder reputation\n` +
           `• Evaluate rental yield potential\n\n` +
           `Would you like more specific information about any of these areas in ${city}?`;
}

// Main Chat Endpoint
app.post("/chat", async (req, res) => {
    console.log("Chat endpoint called with data:", JSON.stringify(req.body));
    
    const { message, propertyDetails } = req.body;
    const userId = req.user ? req.user.id : null;

    if (!process.env.HUGGING_FACE_TOKEN || process.env.HUGGING_FACE_TOKEN === 'your_huggingface_token') {
        console.error("❌ Hugging Face token is missing or invalid");
        return res.status(500).json({ 
            reply: "Server configuration error: API token is missing or invalid.",
            error: "API_TOKEN_ERROR"
        });
    }

    try {
        // Track user query for analytics
        console.log(`User query: "${message}"`);
        
        // Check for specific city mentions or user selections
        const cityMention = message.match(/\b(mumbai|delhi|bangalore|hyderabad|kolkata|chennai|pune)\b/i);
        let response = "";
        
        // Generate appropriate response
        if (message && message.toLowerCase() === 'kolkata' || 
            (cityMention && cityMention[1].toLowerCase() === 'kolkata')) {
            // Specific response for Kolkata as shown in the screenshot
            response = generateCityInvestmentResponse('kolkata');
        } else {
            response = generateResponse(message, propertyDetails);
        }
        
        // Add property valuation if details provided
        let prediction = null;
        if (propertyDetails) {
            prediction = await predictPropertyValue(propertyDetails);
            const formattedPrice = new Intl.NumberFormat('en-IN', {
                style: 'currency',
                currency: 'INR',
                maximumFractionDigits: 0
            }).format(prediction);
            
            response += `\n\nBased on the provided details, I estimate the property value to be approximately ${formattedPrice}.`;
        }

        // Save chat history if user is logged in
        if (userId) {
            try {
                const allChatHistory = readChatHistory();
                
                // Find user's chat history or create a new one
                let userChatIndex = allChatHistory.findIndex(chat => chat.userId === userId);
                
                if (userChatIndex === -1) {
                    // Create new chat history for user
                    allChatHistory.push({
                        userId,
                        messages: [],
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    });
                    userChatIndex = allChatHistory.length - 1;
                }
                
                // Add messages to user's chat history
                allChatHistory[userChatIndex].messages.push({
                    text: message,
                    sender: 'user',
                    timestamp: new Date().toISOString()
                });
                
                allChatHistory[userChatIndex].messages.push({
                    text: response,
                    sender: 'bot',
                    timestamp: new Date().toISOString()
                });
                
                allChatHistory[userChatIndex].updatedAt = new Date().toISOString();
                
                // Save updated chat history
                writeChatHistory(allChatHistory);
                
                console.log(`Saved chat history for user ${userId}`);
            } catch (err) {
                console.error("Error saving chat history:", err);
                // Continue with response even if history saving fails
            }
        }

        console.log("Sending response to client:", response.substring(0, 100) + "...");
        res.json({ 
            reply: response,
            prediction: prediction
        });

    } catch (error) {
        console.error("❌ Error in /chat:", error);
        res.status(500).json({ 
            reply: "I apologize, but I'm having trouble processing your request right now. Please try again in a moment.",
            error: error.message 
        });
    }
});

// Authentication Routes
// Register new user
app.post("/auth/signup", async (req, res) => {
    try {
        const { name, email, password } = req.body;
        
        // Validate input
        if (!name || !email || !password) {
            return res.status(400).json({ message: "All fields are required" });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ message: "Password must be at least 6 characters long" });
        }
        
        // Read existing users
        const users = readUsers();
        
        // Check if user already exists
        const existingUser = users.find(user => user.email === email);
        if (existingUser) {
            return res.status(400).json({ message: "User already exists with this email" });
        }
        
        // Create new user with simple password hashing (for demo only)
        const hashedPassword = Buffer.from(password).toString('base64');
        
        const newUser = {
            id: Date.now().toString(),
            name,
            email,
            password: hashedPassword,
            role: 'user',
            createdAt: new Date().toISOString()
        };
        
        // Add user to users array
        users.push(newUser);
        
        // Save updated users
        writeUsers(users);
        
        // Create token
        const token = jwt.sign(
            { id: newUser.id, email: newUser.email, role: newUser.role },
            JWT_SECRET,
            { expiresIn: '1d' }
        );
        
        // Set cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000 // 1 day
        });
        
        res.status(201).json({
            message: "User registered successfully",
            user: {
                id: newUser.id,
                name: newUser.name,
                email: newUser.email,
                role: newUser.role
            }
        });
    } catch (error) {
        console.error("Error in signup:", error);
        res.status(500).json({ message: "Server error. Please try again later.", error: error.message });
    }
});

// Login user
app.post("/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Validate input
        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required" });
        }
        
        // Read users
        const users = readUsers();
        
        // Find user
        const user = users.find(user => user.email === email);
        if (!user) {
            return res.status(400).json({ message: "Invalid credentials" });
        }
        
        // Check password (simple base64 decode for demo)
        const hashedPassword = Buffer.from(password).toString('base64');
        if (hashedPassword !== user.password) {
            return res.status(400).json({ message: "Invalid credentials" });
        }
        
        // Create token
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '1d' }
        );
        
        // Set cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000 // 1 day
        });
        
        res.json({
            message: "Login successful",
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error("Error in login:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// Logout user
app.post("/auth/logout", (req, res) => {
    res.clearCookie('token');
    res.json({ message: "Logged out successfully" });
});

// Get current user
app.get("/auth/me", async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
        const users = readUsers();
        const user = users.find(user => user.id === req.user.id);
        
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        
        res.json({
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error("Error getting user info:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// Get chat history for a specific user
app.get("/chat/history/:userId?", async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
        // Determine whose history to get
        const targetUserId = req.params.userId || req.user.id;
        
        // Check permission - only admin or the user themselves can access
        if (req.user.role !== 'admin' && req.user.id !== targetUserId) {
            return res.status(403).json({ message: "Unauthorized access" });
        }
        
        const allChatHistory = readChatHistory();
        const userChat = allChatHistory.find(chat => chat.userId === targetUserId);
        
        if (!userChat) {
            return res.json({ messages: [] });
        }
        
        res.json({ messages: userChat.messages });
    } catch (error) {
        console.error("Error getting chat history:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// Start server with port fallback
const startServer = async (initialPort) => {
    // Helper function to check if a port is available
    const isPortAvailable = (port) => {
        return new Promise((resolve) => {
            const server = app.listen(port, () => {
                server.close();
                resolve(true);
            });
            
            server.on('error', () => {
                resolve(false);
            });
        });
    };

    // Find an available port
    const findAvailablePort = async () => {
        // Try a sequence of specific ports instead of incrementing
        const portOptions = [3000, 3001, 8080, 8081, 5000, 5001, 4000, 4001];
        
        for (const port of portOptions) {
            if (await isPortAvailable(port)) {
                return port;
            }
        }
        
        // If all specific ports are taken, use a random port
        return 0; // This will let the OS assign a random available port
    };

    try {
        // Get an available port
        const port = await findAvailablePort();
        
        // Start the server
        const server = app.listen(port, () => {
            console.log(`✅ Real Estate Price Predictor running at http://localhost:${port}`);
            
            // Log additional info for users
            console.log("💾 Using file-based storage - no database required");
            console.log(`📂 Data directory: ${DATA_DIR}`);
            
            // Cross-platform instructions
            if (process.platform === 'win32') {
                console.log("👉 Press Ctrl+C to stop the server (Windows)");
            } else {
                console.log("👉 Press Ctrl+C to stop the server");
            }
        });
        
        // Handle graceful shutdown
        const cleanup = () => {
            console.log("\n⏹️ Shutting down server...");
            server.close(() => {
                console.log("✅ Server shutdown complete");
                process.exit(0);
            });
        };
        
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
        
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

// Start the server with initial port
startServer(PORT);
