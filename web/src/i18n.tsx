import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'ar' | 'en';

const STRINGS = {
  appName: { ar: 'سوا اربيل', en: 'Sawa Erbil' },
  tagline: { ar: 'وصّل الطلبات على شارع الستين', en: 'Deliver orders along Sixty Meter Street' },
  demoNotice: {
    ar: 'نسخة عرض للمستثمرين — جميع الأنشطة التجارية والأسعار وهمية، والعملة افتراضية داخل اللعبة فقط.',
    en: 'Investor demo — all businesses and prices are fictional; the currency is virtual and in-game only.',
  },
  play: { ar: 'ابدأ', en: 'Start' },
  resume: { ar: 'متابعة', en: 'Resume' },
  loading: { ar: 'جارٍ التحميل…', en: 'Loading…' },
  loadingWorld: { ar: 'جارٍ بناء أربيل…', en: 'Building Erbil…' },
  settings: { ar: 'الإعدادات', en: 'Settings' },
  language: { ar: 'اللغة', en: 'Language' },
  graphics: { ar: 'جودة الرسوم', en: 'Graphics quality' },
  low: { ar: 'منخفضة', en: 'Low' },
  medium: { ar: 'متوسطة', en: 'Medium' },
  high: { ar: 'عالية', en: 'High' },
  controls: { ar: 'طريقة التحكم', en: 'Controls' },
  controlButtons: { ar: 'أزرار', en: 'Buttons' },
  controlJoystick: { ar: 'عصا تحكم', en: 'Joystick' },
  controlWheel: { ar: 'مقود', en: 'Wheel' },
  close: { ar: 'إغلاق', en: 'Close' },
  cancel: { ar: 'إلغاء', en: 'Cancel' },
  save: { ar: 'حفظ', en: 'Save' },
  ok: { ar: 'حسناً', en: 'OK' },
  back: { ar: 'رجوع', en: 'Back' },
  vehicle: { ar: 'المركبة', en: 'Vehicle' },
  locked: { ar: 'مقفلة', en: 'Locked' },
  unlocksAtLevel: { ar: 'تُفتح في المستوى {n}', en: 'Unlocks at level {n}' },
  topSpeed: { ar: 'السرعة القصوى', en: 'Top speed' },
  handling: { ar: 'التحكم', en: 'Handling' },
  acceleration: { ar: 'التسارع', en: 'Acceleration' },
  level: { ar: 'المستوى', en: 'Level' },
  coins: { ar: 'دينار افتراضي', en: 'virtual coins' },
  xp: { ar: 'خبرة', en: 'XP' },
  deliveries: { ar: 'التوصيلات', en: 'Deliveries' },
  missions: { ar: 'المهام', en: 'Missions' },
  missionBoard: { ar: 'لوحة الطلبات', en: 'Job board' },
  noMissions: { ar: 'لا توجد مهام متاحة الآن', en: 'No missions available right now' },
  accept: { ar: 'قبول المهمة', en: 'Accept mission' },
  cancelMission: { ar: 'إلغاء المهمة', en: 'Cancel mission' },
  reward: { ar: 'المكافأة', en: 'Reward' },
  distance: { ar: 'المسافة', en: 'Distance' },
  timeLimit: { ar: 'الوقت المحدد', en: 'Time limit' },
  noTimeLimit: { ar: 'بدون وقت محدد', en: 'No time limit' },
  pickupAt: { ar: 'الاستلام من', en: 'Pick up at' },
  deliverTo: { ar: 'التسليم إلى', en: 'Deliver to' },
  package: { ar: 'الطلبية', en: 'Package' },
  goToPickup: { ar: 'اذهب للاستلام', en: 'Go to pickup' },
  goToDropoff: { ar: 'اذهب للتسليم', en: 'Go to drop-off' },
  collect: { ar: 'استلام الطلبية', en: 'Collect order' },
  deliver: { ar: 'تسليم الطلبية', en: 'Deliver order' },
  details: { ar: 'التفاصيل', en: 'Details' },
  away: { ar: 'م', en: 'm' },
  km: { ar: 'كم', en: 'km' },
  kmh: { ar: 'كم/س', en: 'km/h' },
  delivered: { ar: 'تم التوصيل!', en: 'Delivered!' },
  onTimeBonus: { ar: 'مكافأة الوصول في الوقت', en: 'On-time bonus' },
  levelUp: { ar: 'مستوى جديد!', en: 'Level up!' },
  newAchievement: { ar: 'إنجاز جديد', en: 'Achievement unlocked' },
  continue: { ar: 'متابعة', en: 'Continue' },
  history: { ar: 'سجل المهام', en: 'Mission history' },
  achievements: { ar: 'الإنجازات', en: 'Achievements' },
  dailyChallenges: { ar: 'تحديات اليوم', en: "Today's challenges" },
  claim: { ar: 'استلام', en: 'Claim' },
  claimed: { ar: 'تم الاستلام', en: 'Claimed' },
  paused: { ar: 'متوقف مؤقتاً', en: 'Paused' },
  mainMenu: { ar: 'القائمة الرئيسية', en: 'Main menu' },
  menu: { ar: 'القائمة', en: 'Menu' },
  camera: { ar: 'الكاميرا', en: 'Camera' },
  map: { ar: 'الخريطة', en: 'Map' },
  menuTab: { ar: 'القائمة', en: 'Menu' },
  products: { ar: 'المنتجات', en: 'Products' },
  companyServices: { ar: 'خدمات الشركة', en: 'Company services' },
  about: { ar: 'نبذة', en: 'About' },
  hours: { ar: 'ساعات العمل (محاكاة)', en: 'Hours (simulated)' },
  openNow: { ar: 'مفتوح الآن', en: 'Open now' },
  closedNow: { ar: 'مغلق الآن', en: 'Closed now' },
  location: { ar: 'الموقع', en: 'Location' },
  fromYou: { ar: 'منك', en: 'from you' },
  availableMissions: { ar: 'المهام المتاحة', en: 'Available missions' },
  sponsored: { ar: 'راعٍ', en: 'Sponsored' },
  featured: { ar: 'مميز', en: 'Featured' },
  fictional: { ar: 'نشاط وهمي', en: 'Fictional business' },
  illustrativePrices: { ar: 'أسعار توضيحية', en: 'Illustrative prices' },
  iqd: { ar: 'د.ع', en: 'IQD' },
  priceOnRequest: { ar: '—', en: '—' },
  advertise: { ar: 'أعلن معنا', en: 'Advertise with us' },
  packagesInfo: {
    ar: 'باقات توضيحية للعرض فقط — لا يوجد دفع أو اشتراك أو عقد داخل هذا النموذج.',
    en: 'Illustrative packages for the demo only — no payment, subscription or contract happens in this prototype.',
  },
  perMonth: { ar: '/ شهرياً (توضيحي)', en: '/ month (illustrative)' },
  dashboard: { ar: 'لوحة الإدارة', en: 'Admin dashboard' },
  discovered: { ar: 'اكتشفت', en: 'Discovered' },
  tooFar: { ar: 'اقترب أكثر من النقطة', en: 'Get closer to the point' },
  runInProgress: { ar: 'لديك مهمة جارية', en: 'You already have a delivery in progress' },
  managerName: { ar: 'كاك حمه — مدير التوزيع', en: 'Kak Hama — dispatch manager' },
  tut1: { ar: 'أهلاً بك. معك كاك حمه من قسم التوزيع. منطقة عملك اليوم شارع الستين في أربيل.', en: "Welcome aboard. This is Kak Hama from dispatch. Your zone today is Sixty Meter Street, Erbil." },
  tut2: {
    ar: 'استعمل دواسة الوقود والفرامل على اليمين، والتوجيه على اليسار. على الكمبيوتر: الأسهم أو WASD.',
    en: 'Use the throttle and brake on the right, steering on the left. On a computer: arrow keys or WASD.',
  },
  tut3: {
    ar: 'افتح لوحة الطلبات واقبل مهمة، ثم اتبع خط المسار للاستلام والتسليم. الطلبات هشة — قُد بحذر!',
    en: 'Open the job board, accept a mission and follow the route line to pickup and drop-off. Orders are fragile — drive carefully!',
  },
  pickedUp: {
    ar: 'تم استلام الطلبية! اتبع الخط إلى نقطة التسليم.',
    en: 'Order collected! Follow the line to the drop-off.',
  },
  rotateHint: { ar: 'أدر الهاتف أفقياً لتجربة أفضل', en: 'Turn your phone sideways for the best experience' },
  install: { ar: 'تثبيت على الشاشة الرئيسية', en: 'Add to home screen' },
  offlineError: { ar: 'تعذر الاتصال بالخادم', en: 'Could not reach the server' },
  retry: { ar: 'إعادة المحاولة', en: 'Retry' },
  worldUpdated: { ar: 'تم تحديث المحلات على الخريطة', en: 'Businesses on the map were updated' },
  mapAttribution: { ar: 'تخطيط الشوارع تقريبي', en: 'Street layout is approximate' },
  open: { ar: 'فتح', en: 'Open' },
  status_accepted: { ar: 'مقبولة', en: 'Accepted' },
  status_going_to_pickup: { ar: 'في الطريق للاستلام', en: 'Going to pickup' },
  status_collected: { ar: 'تم الاستلام', en: 'Collected' },
  status_going_to_destination: { ar: 'في الطريق للتسليم', en: 'Going to destination' },
  status_delivered: { ar: 'تم التسليم', en: 'Delivered' },
  status_cancelled: { ar: 'ملغاة', en: 'Cancelled' },
  timeUp: { ar: 'انتهى الوقت — لا مكافأة إضافية', en: "Time's up — no bonus" },
  nearby: { ar: 'قريب منك', en: 'Nearby' },
  businesses: { ar: 'المحلات', en: 'Businesses' },
  none: { ar: 'لا شيء بعد', en: 'Nothing yet' },
  riderName: { ar: 'اسم السائق', en: 'Rider name' },
} as const;

export type StringKey = keyof typeof STRINGS;

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
  /** pick the Arabic or English variant of a bilingual record */
  pick: (ar: string | null | undefined, en: string | null | undefined) => string;
  dir: 'rtl' | 'ltr';
  fmtNumber: (n: number) => string;
}

const Ctx = createContext<I18n | null>(null);

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('dg.lang');
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'ar';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('dg.lang', l);
    } catch {
      /* ignore */
    }
  }, []);
  const value = useMemo<I18n>(() => {
    const nf = new Intl.NumberFormat(lang === 'ar' ? 'ar-IQ-u-nu-latn' : 'en-US');
    return {
      lang,
      setLang,
      dir: lang === 'ar' ? 'rtl' : 'ltr',
      t: (key, vars) => {
        let s: string = STRINGS[key][lang];
        if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
        return s;
      },
      pick: (ar, en) => (lang === 'ar' ? ar || en || '' : en || ar || ''),
      fmtNumber: (n) => nf.format(n),
    };
  }, [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside provider');
  return v;
}
