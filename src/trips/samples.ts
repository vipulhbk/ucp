import { TripSchema, type Trip, type ItineraryDay, type Interest, type BudgetTier } from "./types";

/**
 * Ready-made trips for the demo, standing in for a model until one is wired in (see `TripPlanner` in ./types).
 *
 * Everything here is illustrative editorial content: costs are rough per-person estimates in rupees, not quotes, and the
 * places are well-known landmarks and areas named without opening hours, prices or availability. The `bookables` point at
 * demo merchant catalog variants (src/merchant/catalog/data.ts); a test asserts every one exists and stays under the
 * merchant's high-value review limit, so each trip can be bought end to end through UCP checkout.
 */

type Row = ["m" | "a" | "e", title: string, detail: string, area: string, cost: number];
const SLOT = { m: "morning", a: "afternoon", e: "evening" } as const;
const day = (n: number, title: string, rows: Row[]): ItineraryDay => ({
  day: n,
  title,
  items: rows.map(([s, t, detail, area, costInr]) => ({ slot: SLOT[s], title: t, detail, area, costInr })),
});

interface Seed {
  id: string;
  title: string;
  destination: string;
  country: string;
  tagline: string;
  aliases: string[];
  interests: Interest[];
  budgetTier: BudgetTier;
  bestSeason: string;
  highlights: string[];
  itinerary: ItineraryDay[];
  tips: string[];
  stay: string;
  pass: string;
}

const make = (s: Seed): Trip =>
  TripSchema.parse({
    ...s,
    days: s.itinerary.length,
    cover: `/trips/${s.id}.svg`,
    bookables: [
      { variantId: `var_stay_${s.id}`, label: s.stay, quantity: 1 },
      { variantId: `var_pass_${s.id}`, label: s.pass, quantity: 1 },
    ],
  });

export const TRIPS: Trip[] = [
  make({
    id: "paris",
    title: "Paris in four days",
    destination: "Paris",
    country: "France",
    tagline: "Museums by day, the Seine by night.",
    aliases: ["paris", "france", "french", "eiffel"],
    interests: ["art", "romantic", "shopping"],
    budgetTier: 4,
    bestSeason: "April to June, September to October",
    highlights: ["The Louvre and Musée d'Orsay", "Evening Seine cruise", "Montmartre at sunset", "Left Bank cafés and bookshops"],
    stay: "Left Bank boutique stay, 3 nights",
    pass: "Museum and Seine cruise pass",
    itinerary: [
      day(1, "Left Bank arrival", [
        ["m", "Settle in around Saint-Germain", "Drop bags, walk the streets between the river and Luxembourg Gardens.", "Saint-Germain-des-Prés", 0],
        ["a", "Luxembourg Gardens and café lunch", "Slow lunch, then a loop around the palace gardens.", "6th arrondissement", 1800],
        ["e", "Seine-side walk to Notre-Dame", "Browse the riverside booksellers as the light goes gold.", "Île de la Cité", 0],
      ]),
      day(2, "Art all day", [
        ["m", "The Louvre", "Pick three wings rather than trying to see everything.", "1st arrondissement", 1800],
        ["a", "Tuileries and a long lunch", "Cross the gardens, lunch near Palais-Royal.", "Palais-Royal", 2200],
        ["e", "Evening Seine cruise", "An hour on the water past the lit-up bridges.", "Pont de l'Alma", 0],
      ]),
      day(3, "Montmartre and Orsay", [
        ["m", "Musée d'Orsay", "Impressionists in a former railway station.", "7th arrondissement", 1800],
        ["a", "Shopping on the Left Bank", "Concept stores, paper shops and pâtisseries.", "Saint-Sulpice", 3000],
        ["e", "Sunset in Montmartre", "Climb to the basilica steps, then dinner on the hill.", "Montmartre", 3500],
      ]),
      day(4, "A last walk", [
        ["m", "Market breakfast", "Pastries and coffee from a neighbourhood market street.", "Rue Mouffetard", 600],
        ["a", "Departure", "Collect bags and head out.", "Saint-Germain-des-Prés", 0],
      ]),
    ],
    tips: ["Museums are busiest mid-morning; go early or on a late opening.", "A refillable water bottle works at public fountains.", "Demo prices only: confirm real hours and fares before travelling."],
  }),
  make({
    id: "goa",
    title: "Goa beach break",
    destination: "Goa",
    country: "India",
    tagline: "Sun, sea and shacks, with a sunset cruise.",
    aliases: ["goa", "calangute", "baga", "panjim", "panaji"],
    interests: ["beaches", "nightlife", "sports"],
    budgetTier: 2,
    bestSeason: "November to February",
    highlights: ["Water sports at Calangute", "Mandovi sunset cruise", "Old Goa churches", "Beach-shack dinners"],
    stay: "Beachside stay, 4 nights",
    pass: "Water sports and sunset cruise pass",
    itinerary: [
      day(1, "Arrive and unwind", [
        ["m", "Check in near Calangute", "Drop bags and walk down to the beach.", "Calangute", 0],
        ["a", "Beach time", "Sunbeds, coconut water and a long swim.", "Calangute Beach", 800],
        ["e", "Shack dinner", "Fresh seafood on the sand.", "Baga", 1500],
      ]),
      day(2, "Water sports day", [
        ["m", "Parasailing and banana boat", "Book the morning slots, when the water is calmest.", "Calangute Beach", 2500],
        ["a", "Lazy lunch", "Goan fish curry rice, then rest.", "Candolim", 700],
        ["e", "Sunset cruise on the Mandovi", "Music, dance and the city lights from the water.", "Panaji", 1500],
      ]),
      day(3, "Old Goa and Panjim", [
        ["m", "Basilica of Bom Jesus and Sé Cathedral", "Heritage churches an easy drive from the coast.", "Old Goa", 0],
        ["a", "Fontainhas walk", "Pastel Latin Quarter lanes and small galleries.", "Panaji", 500],
        ["e", "Night market", "Browse stalls, then late-night dessert.", "Arpora", 1200],
      ]),
      day(4, "Quiet beaches", [
        ["m", "South Goa drive", "Head to a calmer beach for the morning.", "Palolem", 1500],
        ["a", "Cafe and hammock afternoon", "Read, swim, repeat.", "Palolem", 800],
        ["e", "Beach club night", "Live music for those with energy left.", "Vagator", 2000],
      ]),
      day(5, "Slow departure", [
        ["m", "Breakfast by the sea", "One last swim before packing.", "Calangute", 500],
        ["a", "Departure", "Collect bags and head to the airport.", "Dabolim", 0],
      ]),
    ],
    tips: ["Monsoon (June to September) closes most water sports.", "Rent a scooter only with a valid licence and a helmet.", "Demo prices only."],
  }),
  make({
    id: "jaipur",
    title: "Jaipur: forts, bazaars and block prints",
    destination: "Jaipur",
    country: "India",
    tagline: "The Pink City, through its forts and its markets.",
    aliases: ["jaipur", "rajasthan", "pink city", "amer", "amber"],
    interests: ["art", "shopping", "scenic"],
    budgetTier: 2,
    bestSeason: "October to March",
    highlights: ["Amber Fort at sunrise", "Block-printing workshop", "City Palace and Hawa Mahal", "Bapu Bazaar shopping"],
    stay: "Heritage haveli stay, 3 nights",
    pass: "Forts and crafts guided pass",
    itinerary: [
      day(1, "Into the old city", [
        ["m", "Haveli check-in", "Tea in the courtyard, then a short orientation walk.", "Old City", 0],
        ["a", "City Palace and Jantar Mantar", "Royal rooms and the giant stone observatory.", "Old City", 1000],
        ["e", "Hawa Mahal at dusk", "The palace facade glows as the streets light up.", "Hawa Mahal", 0],
      ]),
      day(2, "Amber Fort day", [
        ["m", "Amber Fort, early", "Arrive at opening to beat the heat and the queues.", "Amer", 800],
        ["a", "Jaigarh Fort and Panna Meena stepwell", "Ramparts, cannons and a geometric stepwell.", "Amer", 600],
        ["e", "Rooftop dinner", "Thali with a view of the lit-up Nahargarh ridge.", "Old City", 1500],
      ]),
      day(3, "Crafts and bazaars", [
        ["m", "Block-printing workshop", "Carve, stamp and take home your own cloth.", "Sanganer", 1200],
        ["a", "Bapu and Johari bazaars", "Jewellery, juttis and textiles. Bargain politely.", "Walled City", 3000],
        ["e", "Lassi and kulfi trail", "A short street-food crawl.", "MI Road", 600],
      ]),
      day(4, "Departure", [
        ["m", "Sunrise at Nahargarh", "Optional early drive for the city view.", "Nahargarh", 300],
        ["a", "Departure", "Collect bags and head out.", "Old City", 0],
      ]),
    ],
    tips: ["Carry a scarf for sun and for temple visits.", "Agree auto-rickshaw fares before you ride.", "Demo prices only."],
  }),
  make({
    id: "bali",
    title: "Bali: temples, terraces and a villa pool",
    destination: "Bali",
    country: "Indonesia",
    tagline: "Slow mornings in Ubud, rice terraces at golden hour.",
    aliases: ["bali", "ubud", "indonesia", "seminyak", "denpasar"],
    interests: ["scenic", "romantic", "art"],
    budgetTier: 3,
    bestSeason: "April to October",
    highlights: ["Tegallalang rice terraces", "Uluwatu temple at sunset", "Ubud art market", "Private-pool villa mornings"],
    stay: "Ubud villa stay, 5 nights",
    pass: "Temples and rice terraces day tours",
    itinerary: [
      day(1, "Arrive in Ubud", [
        ["m", "Villa check-in", "Breakfast by the pool, nothing planned.", "Ubud", 0],
        ["a", "Ubud Monkey Forest", "A shaded walk among ancient temple grounds.", "Ubud", 1000],
        ["e", "Warung dinner", "Nasi campur or bebek betutu at a family-run spot.", "Ubud centre", 1200],
      ]),
      day(2, "Terraces and temples", [
        ["m", "Tegallalang rice terraces", "Walk the terraces before the tour buses arrive.", "Tegallalang", 800],
        ["a", "Tirta Empul holy spring", "A water temple where locals still purify.", "Tampaksiring", 900],
        ["e", "Ubud art market", "Textiles, carvings and small paintings.", "Ubud", 1500],
      ]),
      day(3, "Art and a cooking class", [
        ["m", "Museum and gallery morning", "Balinese painting traditions in a few small museums.", "Ubud", 900],
        ["a", "Cooking class", "Market visit, then cook a five-dish lunch.", "Ubud", 2200],
        ["e", "Legong dance", "A traditional performance in a temple courtyard.", "Ubud Palace", 1000],
      ]),
      day(4, "Down to the coast", [
        ["m", "Drive south", "Scenic roads towards the Bukit peninsula.", "Bukit", 1000],
        ["a", "Beach afternoon", "Swim and sunbathe on a calmer cove.", "Bingin", 800],
        ["e", "Uluwatu temple sunset", "Cliff-top temple and a kecak fire dance.", "Uluwatu", 1500],
      ]),
      day(5, "Wellness day", [
        ["m", "Yoga class", "Open-air shala above the jungle.", "Ubud", 900],
        ["a", "Balinese massage", "A long massage, then the villa pool.", "Ubud", 2000],
        ["e", "Farewell dinner", "Tasting menu or a candlelit warung.", "Ubud", 3000],
      ]),
      day(6, "Departure", [
        ["m", "Late breakfast", "Pack slowly.", "Ubud", 0],
        ["a", "Departure", "Transfer to the airport (allow extra time for traffic).", "Ngurah Rai", 0],
      ]),
    ],
    tips: ["Dress modestly and wear a sarong at temples.", "Traffic is slow; plan one major outing a day.", "Demo prices only."],
  }),
  make({
    id: "kyoto",
    title: "Kyoto: temples, tea and quiet lanes",
    destination: "Kyoto",
    country: "Japan",
    tagline: "Old Japan, one lane at a time.",
    aliases: ["kyoto", "japan", "japanese", "gion", "fushimi"],
    interests: ["art", "scenic", "shopping"],
    budgetTier: 3,
    bestSeason: "March to May, October to November",
    highlights: ["Fushimi Inari's torii gates", "Arashiyama bamboo grove", "Tea ceremony", "Gion's evening lanes"],
    stay: "Machiya townhouse stay, 4 nights",
    pass: "Temples and tea experience pass",
    itinerary: [
      day(1, "Higashiyama", [
        ["m", "Check in to the machiya", "Wooden townhouse, tatami rooms, tea on arrival.", "Higashiyama", 0],
        ["a", "Kiyomizu-dera and old streets", "Walk Ninenzaka and Sannenzaka down from the temple.", "Higashiyama", 700],
        ["e", "Gion at dusk", "Wander the lanes, then a small izakaya dinner.", "Gion", 3000],
      ]),
      day(2, "Gates and gardens", [
        ["m", "Fushimi Inari, early", "Thousands of torii gates; go at first light for quiet.", "Fushimi", 0],
        ["a", "Nishiki Market", "Pickles, tofu doughnuts and knives.", "Central Kyoto", 2000],
        ["e", "Pontocho dinner", "A narrow alley of small restaurants by the river.", "Pontocho", 3500],
      ]),
      day(3, "Arashiyama", [
        ["m", "Bamboo grove and Tenryu-ji", "Go early; the grove fills fast.", "Arashiyama", 800],
        ["a", "Tea ceremony", "A guided ceremony and wagashi sweets.", "Arashiyama", 2500],
        ["e", "Kaiseki dinner", "A seasonal multi-course meal.", "Central Kyoto", 6000],
      ]),
      day(4, "Zen and shopping", [
        ["m", "Ryoan-ji rock garden", "Sit and look. It is the point.", "Kita-ku", 600],
        ["a", "Kinkaku-ji and craft shops", "The Golden Pavilion, then ceramics and paper.", "Kita-ku", 2500],
        ["e", "Philosopher's Path", "A quiet canal walk at golden hour.", "Higashiyama", 0],
      ]),
      day(5, "Departure", [
        ["m", "Breakfast and last souvenirs", "Matcha sweets to take home.", "Kyoto Station", 1200],
        ["a", "Departure", "Train to the airport.", "Kyoto Station", 0],
      ]),
    ],
    tips: ["Many temples close by late afternoon.", "Carry cash; small places often do not take cards.", "Demo prices only."],
  }),
  make({
    id: "singapore",
    title: "Singapore with kids",
    destination: "Singapore",
    country: "Singapore",
    tagline: "Easy, clean and full of things for small people.",
    aliases: ["singapore", "sentosa", "marina bay"],
    interests: ["kids", "shopping", "scenic"],
    budgetTier: 3,
    bestSeason: "February to April",
    highlights: ["Zoo and night safari", "Gardens by the Bay supertrees", "Sentosa beaches", "Hawker-centre meals"],
    stay: "Family suite stay, 4 nights",
    pass: "Family attractions pass",
    itinerary: [
      day(1, "Arrival and Marina Bay", [
        ["m", "Check in near Marina Bay", "A family suite with room to spread out.", "Marina Bay", 0],
        ["a", "Gardens by the Bay", "Walk the supertree grove and the cooled domes.", "Marina Bay", 2000],
        ["e", "Light show and hawker dinner", "Free garden light show, then satay and noodles.", "Marina Bay", 1800],
      ]),
      day(2, "Wildlife day", [
        ["m", "Singapore Zoo", "Go early; animals are most active in the cool morning.", "Mandai", 2800],
        ["a", "River safari", "A boat ride past large animal habitats.", "Mandai", 2500],
        ["e", "Night safari", "A tram ride through the park after dark.", "Mandai", 3200],
      ]),
      day(3, "Sentosa", [
        ["m", "Beach and water play", "Easy sandy beaches with shallow water.", "Sentosa", 500],
        ["a", "Aquarium visit", "One of the largest aquariums in the region.", "Sentosa", 3000],
        ["e", "Cable car home", "Views over the harbour at sunset.", "HarbourFront", 1500],
      ]),
      day(4, "Easy city day", [
        ["m", "Science museum", "Hands-on exhibits for older kids.", "Jurong", 1800],
        ["a", "Orchard Road shopping", "Malls with indoor play areas for tired legs.", "Orchard", 3000],
        ["e", "Chinatown dinner", "Street-food stalls and lantern-lit lanes.", "Chinatown", 1500],
      ]),
      day(5, "Departure", [
        ["m", "Jewel Changi playtime", "Walk the indoor waterfall and play areas before flying.", "Changi", 1000],
        ["a", "Departure", "Check in and head home.", "Changi", 0],
      ]),
    ],
    tips: ["Carry a light jacket; indoor spaces are heavily air-conditioned.", "Rain is short and frequent; keep a spare plan.", "Demo prices only."],
  }),
  make({
    id: "manali",
    title: "Manali: mountains and adrenaline",
    destination: "Manali",
    country: "India",
    tagline: "River rafting, paragliding and pine-forest quiet.",
    aliases: ["manali", "himachal", "kullu", "solang", "rohtang"],
    interests: ["sports", "scenic", "romantic"],
    budgetTier: 1,
    bestSeason: "March to June, September to October",
    highlights: ["River rafting on the Beas", "Tandem paragliding at Solang", "Old Manali cafés", "Hadimba temple forest"],
    stay: "Mountain-view cottage stay, 3 nights",
    pass: "Adventure pack (rafting and paragliding)",
    itinerary: [
      day(1, "Arrive and settle", [
        ["m", "Cottage check-in", "Chai on the balcony with the valley view.", "Old Manali", 0],
        ["a", "Hadimba Devi Temple", "A wooden temple inside a cedar forest.", "Manali", 100],
        ["e", "Old Manali cafés", "Live music and trout or momos.", "Old Manali", 800],
      ]),
      day(2, "River and sky", [
        ["m", "River rafting", "Grade-II to III rapids on the Beas.", "Kullu", 1200],
        ["a", "Lunch by the river", "Simple dhaba lunch, then rest.", "Kullu", 400],
        ["e", "Mall Road walk", "Woollens and warm snacks.", "Mall Road", 600],
      ]),
      day(3, "Solang valley", [
        ["m", "Tandem paragliding", "A short flight with a licensed pilot, weather permitting.", "Solang Valley", 3000],
        ["a", "Ropeway and viewpoints", "Panoramas over the snow line.", "Solang Valley", 700],
        ["e", "Bonfire at the cottage", "Stargazing if the sky is clear.", "Old Manali", 0],
      ]),
      day(4, "Departure", [
        ["m", "Vashisht hot springs", "A short walk and a soak.", "Vashisht", 100],
        ["a", "Departure", "Descend the valley road.", "Manali", 0],
      ]),
    ],
    tips: ["Mountain weather changes quickly; carry layers.", "Adventure activities depend on weather and operator safety checks.", "Demo prices only."],
  }),
  make({
    id: "santorini",
    title: "Santorini: caldera sunsets",
    destination: "Santorini",
    country: "Greece",
    tagline: "White villages, blue domes, long sunsets.",
    aliases: ["santorini", "greece", "greek", "oia", "thira", "fira"],
    interests: ["romantic", "scenic", "beaches"],
    budgetTier: 4,
    bestSeason: "May to June, September to October",
    highlights: ["Oia sunset", "Caldera catamaran sail", "Fira to Oia clifftop walk", "Volcanic beaches"],
    stay: "Caldera-view stay, 4 nights",
    pass: "Caldera sunset sailing",
    itinerary: [
      day(1, "Arrive in Oia", [
        ["m", "Suite check-in", "Breakfast on the terrace above the caldera.", "Oia", 0],
        ["a", "Wander Oia's lanes", "Galleries, blue domes and quiet corners.", "Oia", 1500],
        ["e", "Oia sunset", "Claim a spot early; it fills up fast.", "Oia Castle", 0],
      ]),
      day(2, "Sail the caldera", [
        ["m", "Catamaran departs", "Swim stops at a hot-spring cove and a red-sand beach.", "Ammoudi Bay", 6500],
        ["a", "Lunch on board", "Grilled fish and local wine.", "Caldera", 0],
        ["e", "Sunset from the water", "The best view of the cliffs lit orange.", "Caldera", 0],
      ]),
      day(3, "Fira and the cliff path", [
        ["m", "Fira to Oia walk", "A clifftop path of about three hours; start early.", "Fira", 0],
        ["a", "Taverna lunch in Imerovigli", "Tomato fritters and a sea view.", "Imerovigli", 2500],
        ["e", "Wine tasting", "Volcanic-soil whites with a sunset view.", "Pyrgos", 3500],
      ]),
      day(4, "Beaches and ruins", [
        ["m", "Akrotiri archaeological site", "A Bronze Age town preserved under volcanic ash.", "Akrotiri", 1800],
        ["a", "Red Beach and Perissa", "Swim on volcanic sand.", "Perissa", 1200],
        ["e", "Farewell dinner", "A table by the cliff edge.", "Fira", 5000],
      ]),
      day(5, "Departure", [
        ["m", "Slow breakfast", "One last look at the caldera.", "Oia", 0],
        ["a", "Departure", "Transfer to the airport.", "Santorini Airport", 0],
      ]),
    ],
    tips: ["Steps are steep and uneven; pack light.", "Book sunset dinners ahead in summer.", "Demo prices only."],
  }),
];

export const tripById = (id: string): Trip | undefined => TRIPS.find((t) => t.id === id);
