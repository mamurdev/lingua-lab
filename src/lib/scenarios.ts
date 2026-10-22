export interface ScenarioObjective {
  id: string;
  text: string;
  completed: boolean;
  hints?: Record<string, string>; // Language-keyed authentic phrase hint
}

export interface Scenario {
  id: string;
  title: string;
  icon: string;
  category: 'dining' | 'travel' | 'shopping' | 'transit' | 'emergency' | 'social';
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  description: string;
  aiRole: string;
  userRole: string;
  setting: string;
  starterPrompt?: Record<string, string>; // Kickoff greeting from the AI partner
  objectives: ScenarioObjective[];
}

export const CURATED_SCENARIOS: Scenario[] = [
  {
    id: 'cafe-order',
    title: 'Ordering at a Café',
    icon: '☕',
    category: 'dining',
    difficulty: 'Beginner',
    description: 'Order your morning coffee and a pastry, ask for recommendations, and settle the bill.',
    aiRole: 'Friendly Café Barista / Server',
    userRole: 'Customer stopping by for breakfast',
    setting: 'A cozy neighborhood café with fresh pastries on display and coffee brewing.',
    starterPrompt: {
      Spanish: '¡Hola! Bienvenido al Café Sol. ¿Qué le gustaría tomar hoy?',
      French: 'Bonjour ! Bienvenue au Café de Flore. Que puis-je vous servir aujourd’hui ?',
      Korean: '안녕하세요! 카페에 오신 것을 환영합니다. 무엇을 주문하시겠어요?',
      Japanese: 'いらっしゃいませ！カフェへようこそ。何をご注文なさいますか？',
      German: 'Guten Tag! Willkommen im Café. Was darf ich Ihnen bringen?',
      English: 'Hello! Welcome to the café. What can I get started for you today?',
    },
    objectives: [
      {
        id: 'obj-greet-table',
        text: 'Greet the server and ask for a table (or order at the counter)',
        completed: false,
        hints: {
          Spanish: 'Buenos días / Una mesa para dos, por favor.',
          French: 'Bonjour, une table pour deux s’il vous plaît.',
          Korean: '안녕하세요, 두 명 자리 있나요?',
          Japanese: 'こんにちは、2人席はありますか？',
          German: 'Guten Morgen, ein Tisch für zwei bitte.',
          English: 'Good morning, a table for two please.',
        },
      },
      {
        id: 'obj-order-drink',
        text: 'Order a coffee (or tea) and a pastry or snack',
        completed: false,
        hints: {
          Spanish: 'Quisiera un café con leche y un cruasán, por favor.',
          French: 'Je voudrais un café au lait et un croissant, s’il vous plaît.',
          Korean: '따뜻한 라떼 한 잔과 크루아상 하나 주세요.',
          Japanese: 'ホットラテとクロワッサンを一つください。',
          German: 'Ich möchte bitte einen Cappuccino und ein Croissant.',
          English: 'I would like a cappuccino and a croissant, please.',
        },
      },
      {
        id: 'obj-ask-recommendation',
        text: 'Ask the server for their recommendation or ingredient details',
        completed: false,
        hints: {
          Spanish: '¿Qué me recomienda de comer / tomar?',
          French: 'Qu’est-ce que vous me recommandez ?',
          Korean: '여기서 제일 인기 있는 메뉴가 뭐예요?',
          Japanese: 'おすすめのメニューは何ですか？',
          German: 'Was können Sie empfehlen?',
          English: 'What do you recommend here?',
        },
      },
      {
        id: 'obj-ask-bill',
        text: 'Ask for the bill and ask if card payment is accepted',
        completed: false,
        hints: {
          Spanish: '¿Me trae la cuenta, por favor? ¿Aceptan tarjeta?',
          French: 'L’addition s’il vous plaît. Est-ce que vous acceptez la carte ?',
          Korean: '계산서 부탁드립니다. 카드 결제 되나요?',
          Japanese: 'お会計をお願いします。カードは使えますか？',
          German: 'Die Rechnung bitte. Kann ich mit Karte zahlen?',
          English: 'Could I get the check, please? Do you take card?',
        },
      },
    ],
  },
  {
    id: 'hotel-checkin',
    title: 'Hotel Check-In & Amenities',
    icon: '🏨',
    category: 'travel',
    difficulty: 'Beginner',
    description: 'Check into your hotel room, ask for the WiFi password, and inquire about breakfast.',
    aiRole: 'Front Desk Concierge',
    userRole: 'Traveler arriving with luggage',
    setting: 'A boutique hotel front desk in the city center after a long travel day.',
    starterPrompt: {
      Spanish: '¡Buenas tardes! Bienvenido al Hotel Central. ¿En qué le puedo colaborar?',
      French: 'Bonjour et bienvenue à l’Hôtel Lumière. Avez-vous une réservation ?',
      Korean: '안녕하세요! 호텔에 오신 것을 환영합니다. 예약하셨나요?',
      Japanese: 'いらっしゃいませ。ホテルへようこそ。ご予約のお名前を伺えますか？',
      German: 'Guten Tag, herzlich willkommen im Hotel. Haben Sie eine Reservierung?',
      English: 'Good afternoon and welcome! How can I assist you with check-in today?',
    },
    objectives: [
      {
        id: 'obj-state-reservation',
        text: 'State that you have a reservation and give your name',
        completed: false,
        hints: {
          Spanish: 'Tengo una reserva a nombre de [su nombre].',
          French: 'J’ai une réservation au nom de [votre nom].',
          Korean: '[이름]으로 예약했습니다.',
          Japanese: '[名前]で予約しています。',
          German: 'Ich habe eine Reservierung auf den Namen [Ihr Name].',
          English: 'I have a reservation under the name [your name].',
        },
      },
      {
        id: 'obj-ask-wifi-breakfast',
        text: 'Ask for the WiFi password and breakfast hours',
        completed: false,
        hints: {
          Spanish: '¿Cuál es la contraseña del WiFi y a qué hora es el desayuno?',
          French: 'Quel est le mot de passe du WiFi et à quelle heure est le petit-déjeuner ?',
          Korean: '와이파이 비밀번호와 조식 시간이 언제인가요?',
          Japanese: 'Wi-Fiのパスワードと朝食の時間を教えていただけますか？',
          German: 'Wie lautet das WLAN-Passwort und wann gibt es Frühstück?',
          English: 'What is the WiFi password, and what time is breakfast served?',
        },
      },
      {
        id: 'obj-ask-luggage-directions',
        text: 'Inquire about luggage storage or ask for directions to a landmark',
        completed: false,
        hints: {
          Spanish: '¿Puedo dejar mi equipaje aquí mientras visito la ciudad?',
          French: 'Puis-je laisser mes bagages ici ? Comment aller à la gare ?',
          Korean: '짐을 맡겨둘 수 있나요? 지하철역은 어디인가요?',
          Japanese: '荷物を預かってもらえますか？駅へはどう行けばいいですか？',
          German: 'Kann ich mein Gepäck hier abstellen?',
          English: 'Can I leave my bags here? How do I get to the city center?',
        },
      },
    ],
  },
  {
    id: 'market-shopping',
    title: 'Market Bargaining & Shopping',
    icon: '🛍️',
    category: 'shopping',
    difficulty: 'Intermediate',
    description: 'Browse fresh fruit or souvenirs, ask about sizes/colors, and negotiate the price.',
    aiRole: 'Lively Street Market Vendor',
    userRole: 'Shopper browsing market stalls',
    setting: 'A bustling outdoor morning market filled with fresh fruits, crafts, and aromas.',
    starterPrompt: {
      Spanish: '¡Acérquese amigo! Tenemos las frutas más frescas del mercado. ¿Qué le provoca hoy?',
      French: 'Approchez, approchez ! Produits frais du jour ! Vous cherchez quelque chose de particulier ?',
      Korean: '어서 오세요! 오늘 막 들어온 싱싱한 과일 많아요. 구경하고 가세요!',
      Japanese: 'いらっしゃい！新鮮な果物がたくさんあるよ。何かお探しですか？',
      German: 'Guten Morgen! Frisches Obst und Handwerk direkt aus der Region. Was darf es sein?',
      English: 'Step right up! Fresh produce and handcrafted gifts today. Looking for anything special?',
    },
    objectives: [
      {
        id: 'obj-ask-price',
        text: 'Ask the price of an item or fruit by weight',
        completed: false,
        hints: {
          Spanish: '¿Cuánto cuesta el kilo de manzanas / esta artesanía?',
          French: 'Combien coûte le kilo de pommes / cet objet ?',
          Korean: '이거 한 킬로에 얼마예요?',
          Japanese: 'これはいくらですか？',
          German: 'Wie viel kostet das Kilo Äpfel?',
          English: 'How much is a kilo of these / this item?',
        },
      },
      {
        id: 'obj-ask-variety',
        text: 'Ask if they have another color, size, or fresher variety',
        completed: false,
        hints: {
          Spanish: '¿Tiene esto en otro color o tamaño más grande?',
          French: 'Avez-vous une autre taille ou une autre couleur ?',
          Korean: '혹시 다른 색상이나 더 큰 사이즈 있나요?',
          Japanese: '他の色やサイズはありますか？',
          German: 'Haben Sie das auch in einer anderen Farbe oder Größe?',
          English: 'Do you have this in a different color or larger size?',
        },
      },
      {
        id: 'obj-negotiate-buy',
        text: 'Politely negotiate a slight discount and confirm purchase',
        completed: false,
        hints: {
          Spanish: 'Si me llevo dos, ¿me hace un descuento? Me lo llevo.',
          French: 'Si j’en prends deux, pouvez-vous me faire un petit prix ?',
          Korean: '두 개 사면 조금 깎아주실 수 있나요? 이걸로 할게요.',
          Japanese: '2つ買うので少し安くなりませんか？これにします。',
          German: 'Gibt es einen Rabatt, wenn ich zwei nehme? Ich nehme es.',
          English: 'Could you give me a small discount if I take two? I’ll take it.',
        },
      },
    ],
  },
  {
    id: 'city-taxi',
    title: 'Taking a Taxi & Navigation',
    icon: '🚕',
    category: 'transit',
    difficulty: 'Intermediate',
    description: 'Give destination instructions to your driver, ask about the fare, and request an ATM stop.',
    aiRole: 'Local City Cab Driver',
    userRole: 'Passenger in the back seat',
    setting: 'Inside a yellow city taxi navigating urban traffic.',
    starterPrompt: {
      Spanish: '¡Buenas! ¿A dónde lo llevo hoy, jefe?',
      French: 'Bonjour monsieur/dame, où allons-nous ?',
      Korean: '안녕하세요, 어디로 모실까요?',
      Japanese: 'ご乗車ありがとうございます。どちらまで行かれますか？',
      German: 'Hallo! Wohin darf die Fahrt gehen?',
      English: 'Hop in! Where are we headed today?',
    },
    objectives: [
      {
        id: 'obj-destination',
        text: 'Give your exact destination address or landmark',
        completed: false,
        hints: {
          Spanish: 'Al Museo Nacional / a la estación de tren, por favor.',
          French: 'À la gare centrale s’il vous plaît.',
          Korean: '서울역으로 가주세요.',
          Japanese: '東京駅までお願いします。',
          German: 'Zum Hauptbahnhof, bitte.',
          English: 'To the Central Train Station, please.',
        },
      },
      {
        id: 'obj-estimate-fare',
        text: 'Ask about estimated time of arrival or fare calculation',
        completed: false,
        hints: {
          Spanish: '¿Cuánto tiempo tardaremos aproximadamente y cuánto saldrá?',
          French: 'Combien de temps cela va-t-il prendre à peu près ?',
          Korean: '도착하는 데 얼마나 걸릴까요? 요금은 대략 얼마 나오나요?',
          Japanese: 'どれくらい時間がかかりますか？運賃はいくら位ですか？',
          German: 'Wie lange dauert es ungefähr und wie viel wird es kosten?',
          English: 'How long will it take to get there, and about how much will it cost?',
        },
      },
      {
        id: 'obj-request-stop',
        text: 'Politely request to make a quick stop at an ATM or store',
        completed: false,
        hints: {
          Spanish: '¿Podríamos parar un momento en un cajero automático en el camino?',
          French: 'Est-il possible de faire un arrêt rapide à un distributeur ?',
          Korean: '가는 길에 편의점이나 현금인출기 잠깐 들러주실 수 있나요?',
          Japanese: '途中のATMで少し停まっていただけますか？',
          German: 'Können wir unterwegs kurz an einem Bankautomaten halten?',
          English: 'Could we please make a quick stop at an ATM on the way?',
        },
      },
    ],
  },
  {
    id: 'pharmacy-visit',
    title: 'Visiting the Local Pharmacy',
    icon: '💊',
    category: 'emergency',
    difficulty: 'Intermediate',
    description: 'Describe common symptoms, ask for dosage advice, and check for side effects.',
    aiRole: 'Licensed Pharmacy Chemist',
    userRole: 'Customer needing medication for travel ailments',
    setting: 'A clean, well-stocked local pharmacy counter.',
    starterPrompt: {
      Spanish: 'Buenas tardes. ¿En qué le puedo asesorar hoy?',
      French: 'Bonjour, que puis-je faire pour vous ? Vous ne vous sentez pas bien ?',
      Korean: '안녕하세요, 어디가 불편해서 오셨나요?',
      Japanese: 'こんにちは、どのような症状ですか？',
      German: 'Guten Tag, wie kann ich Ihnen heute helfen?',
      English: 'Hello, how can I help you today? Are you experiencing any symptoms?',
    },
    objectives: [
      {
        id: 'obj-describe-symptoms',
        text: 'Describe symptoms clearly (e.g. headache, fever, sore throat, or allergies)',
        completed: false,
        hints: {
          Spanish: 'Tengo dolor de cabeza y fiebre desde ayer.',
          French: 'J’ai un fort mal de gorge et des maux de tête depuis hier.',
          Korean: '어제부터 목이 아프고 열이 조금 나요.',
          Japanese: '昨日から頭痛と喉の痛みがあります。',
          German: 'Ich habe Halsschmerzen und seit gestern leichtes Fieber.',
          English: 'I have had a sore throat and headache since yesterday.',
        },
      },
      {
        id: 'obj-ask-dosage',
        text: 'Ask about the proper dosage and how many times per day to take it',
        completed: false,
        hints: {
          Spanish: '¿Cuántas pastillas debo tomar y cada cuántas horas?',
          French: 'Quelle est la posologie ? Combien de fois par jour ?',
          Korean: '하루에 몇 번, 몇 알씩 먹어야 하나요?',
          Japanese: '1日に何回、何錠飲めばいいですか？',
          German: 'Wie oft am Tag soll ich das Medikament einnehmen?',
          English: 'How many times a day should I take this, and with food?',
        },
      },
      {
        id: 'obj-check-effects',
        text: 'Inquire if the medicine causes drowsiness or requires a prescription',
        completed: false,
        hints: {
          Spanish: '¿Este medicamento da sueño o necesita receta médica?',
          French: 'Est-ce que cela provoque de la somnolence ? Faut-il une ordonnance ?',
          Korean: '혹시 졸린 성분이 들어있나요? 처방전이 필요한가요?',
          Japanese: '眠くなる成分は入っていますか？処方箋は必要ですか？',
          German: 'Macht das Medikament müde? Braucht man ein Rezept?',
          English: 'Does this medication cause drowsiness, or require a prescription?',
        },
      },
    ],
  },
  {
    id: 'airport-immigration',
    title: 'Airport Customs & Immigration',
    icon: '✈️',
    category: 'travel',
    difficulty: 'Advanced',
    description: 'Answer border control questions, declare your travel purpose, and ask for transit tips.',
    aiRole: 'Border Control & Immigration Officer',
    userRole: 'International traveler entering the country',
    setting: 'The primary passport inspection booth at the international arrivals hall.',
    starterPrompt: {
      Spanish: 'Pasaporte, por favor. ¿Cuál es el motivo de su visita y cuánto tiempo piensa quedarse?',
      French: 'Passeport s’il vous plaît. Quel est le motif de votre séjour et combien de temps restez-vous ?',
      Korean: '여권 보여주세요. 방문 목적과 체류 기간이 어떻게 되십니까?',
      Japanese: 'パスポートを拝見します。ご入国の目的と滞在期間を教えてください。',
      German: 'Ihren Reisepass bitte. Was ist der Zweck Ihrer Reise und wie lange bleiben Sie?',
      English: 'Passport please. What is the purpose of your visit, and how long do you plan to stay?',
    },
    objectives: [
      {
        id: 'obj-state-purpose-stay',
        text: 'State the purpose of your trip (tourism/business) and duration of stay',
        completed: false,
        hints: {
          Spanish: 'Vengo por turismo y me quedaré por dos semanas.',
          French: 'Je viens pour les vacances et je reste pendant deux semaines.',
          Korean: '관광 목적으로 왔고 2주 동안 머물 예정입니다.',
          Japanese: '観光で来ました。2週間滞在する予定です。',
          German: 'Ich bin als Tourist hier und bleibe für zwei Wochen.',
          English: 'I am here for tourism and will be staying for two weeks.',
        },
      },
      {
        id: 'obj-provide-accommodation',
        text: 'Name your hotel/accommodation and show return flight intent',
        completed: false,
        hints: {
          Spanish: 'Me hospedo en el Hotel Lumière y tengo mi vuelo de regreso el día 15.',
          French: 'Je loge à l’Hôtel Central et j’ai mon billet de retour.',
          Korean: '센트럴 호텔에 묵으며 왕복 항공권을 소지하고 있습니다.',
          Japanese: 'ホテルに宿泊予定で、帰りの航空券も持っています。',
          German: 'Ich übernachte im Stadt-Hotel und habe bereits mein Rückflugticket.',
          English: 'I am staying at the Central Hotel, and I have my return ticket.',
        },
      },
      {
        id: 'obj-confirm-declarations',
        text: 'Confirm that you have nothing illegal to declare',
        completed: false,
        hints: {
          Spanish: 'No tengo nada que declarar, solo artículos de uso personal.',
          French: 'Je n’ai rien à déclarer, uniquement des effets personnels.',
          Korean: '신고할 물품이 없으며 개인 소지품만 있습니다.',
          Japanese: '申告するものは何もありません。身の回りの品だけです。',
          German: 'Ich habe nichts zu verzollen, nur persönliche Gegenstände.',
          English: 'I have nothing to declare, only personal luggage.',
        },
      },
    ],
  },
];

export function getCuratedScenarios(level?: string): Scenario[] {
  if (!level) return CURATED_SCENARIOS;
  return CURATED_SCENARIOS.filter((s) => s.difficulty === level || level === 'All');
}

export function getScenarioById(id: string): Scenario | undefined {
  const found = CURATED_SCENARIOS.find((s) => s.id === id);
  if (!found) return undefined;
  // Return deep clone so mutations don't alter the blueprint
  return JSON.parse(JSON.stringify(found));
}

export function getStoredScenario(conversationId: string): Scenario | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`lingua_scenario_${conversationId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveStoredScenario(conversationId: string, scenario: Scenario): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`lingua_scenario_${conversationId}`, JSON.stringify(scenario));
  } catch {
    /* ignore write errors */
  }
}

export function toggleStoredObjective(conversationId: string, objectiveId: string): Scenario | null {
  const current = getStoredScenario(conversationId);
  if (!current) return null;
  const updatedObjectives = current.objectives.map((obj) =>
    obj.id === objectiveId ? { ...obj, completed: !obj.completed } : obj
  );
  const updatedScenario = { ...current, objectives: updatedObjectives };
  saveStoredScenario(conversationId, updatedScenario);
  return updatedScenario;
}
