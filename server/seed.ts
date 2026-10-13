// Fictional demonstration dataset. Every business, logo, menu and price below
// is invented for the investor demo and does not represent a real company.

import { district } from '../shared/district';
import { buildRoadGraph, routeBetween } from '../shared/roads';
import type { BuildingType, MissionType, PackageBenefits, PackageFeature } from '../shared/types';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './auth';
import type { Db, Tx } from './db';
import { withTx } from './db';
import { kerbPoint, placeBeside, type Placement } from './placement';

const graph = buildRoadGraph(district);

interface CategorySeed {
  slug: string;
  name_ar: string;
  name_en: string;
  default_building_type: BuildingType;
  color: string;
}

const CATEGORIES: CategorySeed[] = [
  { slug: 'restaurants', name_ar: 'مطاعم ومقاهي', name_en: 'Restaurants & cafés', default_building_type: 'restaurant', color: '#e4572e' },
  { slug: 'grocery', name_ar: 'بقالة وسوبرماركت', name_en: 'Grocery & supermarkets', default_building_type: 'shop', color: '#2e9e5b' },
  { slug: 'retail', name_ar: 'متاجر تجزئة', name_en: 'Retail shops', default_building_type: 'shop', color: '#7b4fd6' },
  { slug: 'pharmacy', name_ar: 'صيدليات (محاكاة)', name_en: 'Pharmacies (simulated)', default_building_type: 'shop', color: '#0fa3a3' },
  { slug: 'electronics', name_ar: 'إلكترونيات وأجهزة', name_en: 'Electronics & appliances', default_building_type: 'shop', color: '#1d6fe0' },
  { slug: 'industrial', name_ar: 'شركات صناعية', name_en: 'Industrial companies', default_building_type: 'factory', color: '#8a6d3b' },
  { slug: 'factories', name_ar: 'مصانع', name_en: 'Factories', default_building_type: 'factory', color: '#b5651d' },
  { slug: 'warehouses', name_ar: 'مستودعات', name_en: 'Warehouses', default_building_type: 'warehouse', color: '#5a6b7d' },
  { slug: 'offices', name_ar: 'مكاتب الشركات', name_en: 'Corporate offices', default_building_type: 'office', color: '#334e9e' },
];

interface MerchantSeed {
  key: string;
  name_ar: string;
  name_en: string;
  category: string;
  building_type: BuildingType;
  color: string;
  place: Placement;
  description_ar: string;
  description_en: string;
  address_ar: string;
  address_en: string;
  hours: { open: string; close: string; days: string };
  sign_size?: 'small' | 'medium' | 'large';
  sign_position?: 'front' | 'roof' | 'pylon';
  interior?: boolean;
  menu?: [string, string, number | null, string?, string?][];
}

const DEMO_NOTE_AR = 'نشاط تجاري وهمي لأغراض العرض فقط.';
const DEMO_NOTE_EN = 'Fictional business for demonstration only.';

const MERCHANTS: MerchantSeed[] = [
  {
    key: 'abu-ali',
    name_ar: 'مطعم أبو علي',
    name_en: 'Abu Ali Restaurant',
    category: 'restaurants',
    building_type: 'restaurant',
    color: '#c0392b',
    place: placeBeside('sixty-meter', 0.4, -1, 'restaurant'),
    description_ar: `مشويات عراقية وكردية على الفحم، وأطباق يومية للعائلات. ${DEMO_NOTE_AR}`,
    description_en: `Charcoal-grilled Iraqi and Kurdish dishes with daily family plates. ${DEMO_NOTE_EN}`,
    address_ar: 'شارع الستين متري، الجهة الداخلية',
    address_en: 'Sixty Meter Street, inner side',
    hours: { open: '11:00', close: '23:30', days: 'Sat–Thu' },
    sign_size: 'large',
    interior: true,
    menu: [
      ['كباب أربيلي', 'Erbil kebab', 9000, 'سيخان مع خبز التنور', 'Two skewers with tannour bread'],
      ['تكة دجاج', 'Chicken tikka', 8000],
      ['دولمة', 'Dolma', 7000],
      ['كبة حلب', 'Kubba Halab', 4000],
      ['شوربة عدس', 'Lentil soup', 2500],
      ['لبن عيران', 'Ayran', 1000],
      ['شاي عراقي', 'Iraqi tea', 500],
    ],
  },
  {
    key: 'citadel-cafe',
    name_ar: 'مقهى إطلالة القلعة',
    name_en: 'Citadel View Café',
    category: 'restaurants',
    building_type: 'restaurant',
    color: '#6f4e37',
    place: placeBeside('sixty-meter', 0.53, -1, 'restaurant'),
    description_ar: `قهوة مختصة وحلويات خفيفة. ${DEMO_NOTE_AR}`,
    description_en: `Specialty coffee and light desserts. ${DEMO_NOTE_EN}`,
    address_ar: 'شارع الستين متري',
    address_en: 'Sixty Meter Street',
    hours: { open: '08:00', close: '00:00', days: 'Daily' },
    menu: [
      ['قهوة عربية', 'Arabic coffee', 2000],
      ['لاتيه', 'Latte', 4000],
      ['كليجة بالتمر', 'Date klecha', 3000],
      ['كيك الفستق', 'Pistachio cake', 5000],
    ],
  },
  {
    key: 'pizza-sixty',
    name_ar: 'بيتزا الستين',
    name_en: 'Pizza Sixty',
    category: 'restaurants',
    building_type: 'restaurant',
    color: '#e67e22',
    place: placeBeside('sixty-meter', 0.75, -1, 'restaurant'),
    description_ar: `بيتزا مخبوزة في فرن حطب. ${DEMO_NOTE_AR}`,
    description_en: `Wood-fired pizza. ${DEMO_NOTE_EN}`,
    address_ar: 'شارع الستين متري، قرب جادة المكاتب',
    address_en: 'Sixty Meter Street, near Office Avenue',
    hours: { open: '12:00', close: '01:00', days: 'Daily' },
    menu: [
      ['بيتزا مارغريتا', 'Margherita', 9000],
      ['بيتزا لحم', 'Meat pizza', 12000],
      ['بيتزا خضار', 'Vegetable pizza', 10000],
      ['مشروب غازي', 'Soft drink', 1000],
    ],
  },
  {
    key: 'nishtiman',
    name_ar: 'شاورما نشتمان',
    name_en: 'Nishtiman Shawarma',
    category: 'restaurants',
    building_type: 'restaurant',
    color: '#d35400',
    place: placeBeside('forty-meter', 0.35, 1, 'restaurant'),
    description_ar: `شاورما لحم ودجاج وصمون حار. ${DEMO_NOTE_AR}`,
    description_en: `Beef and chicken shawarma in fresh samoon. ${DEMO_NOTE_EN}`,
    address_ar: 'شارع الأربعين متري',
    address_en: 'Forty Meter Street',
    hours: { open: '10:00', close: '02:00', days: 'Daily' },
    menu: [
      ['شاورما دجاج صمون', 'Chicken shawarma samoon', 3000],
      ['شاورما لحم صمون', 'Beef shawarma samoon', 4000],
      ['وجبة شاورما عائلية', 'Family shawarma meal', 18000],
      ['بطاطا مقلية', 'Fries', 1500],
    ],
  },
  {
    key: 'hawler-bakery',
    name_ar: 'مخبز وحلويات هولير',
    name_en: 'Hawler Bakery & Sweets',
    category: 'restaurants',
    building_type: 'restaurant',
    color: '#b8860b',
    place: placeBeside('forty-meter', 0.65, 1, 'restaurant'),
    description_ar: `خبز تنور وكليجة وحلويات شرقية. ${DEMO_NOTE_AR}`,
    description_en: `Tannour bread, klecha and Middle Eastern sweets. ${DEMO_NOTE_EN}`,
    address_ar: 'شارع الأربعين متري',
    address_en: 'Forty Meter Street',
    hours: { open: '06:00', close: '22:00', days: 'Daily' },
    menu: [
      ['خبز تنور (5 أرغفة)', 'Tannour bread (5)', 1000],
      ['كليجة (كيلو)', 'Klecha (1 kg)', 8000],
      ['بقلاوة (كيلو)', 'Baklava (1 kg)', 15000],
    ],
  },
  {
    key: 'fresh-market',
    name_ar: 'سوق أربيل الطازج',
    name_en: 'Erbil Fresh Market',
    category: 'grocery',
    building_type: 'shop',
    color: '#27ae60',
    place: placeBeside('sixty-meter', 0.57, 1, 'shop'),
    description_ar: `خضار وفواكه يومية ومواد غذائية. ${DEMO_NOTE_AR}`,
    description_en: `Daily produce and pantry essentials. ${DEMO_NOTE_EN}`,
    address_ar: 'شارع الستين متري، الجهة الخارجية',
    address_en: 'Sixty Meter Street, outer side',
    hours: { open: '07:00', close: '23:00', days: 'Daily' },
    sign_position: 'roof',
    menu: [
      ['سلة خضار (5 كغ)', 'Vegetable box (5 kg)', 12000],
      ['عسل جبلي', 'Mountain honey', 25000],
      ['أرز (10 كغ)', 'Rice (10 kg)', 18000],
    ],
  },
  {
    key: 'zagros-electronics',
    name_ar: 'زاغروس للإلكترونيات',
    name_en: 'Zagros Electronics',
    category: 'electronics',
    building_type: 'shop',
    color: '#1f6fd1',
    place: placeBeside('sixty-meter', 0.36, 1, 'shop'),
    description_ar: `هواتف وأجهزة منزلية وإكسسوارات. ${DEMO_NOTE_AR}`,
    description_en: `Phones, home appliances and accessories. ${DEMO_NOTE_EN}`,
    address_ar: 'شارع الستين متري، الجهة الخارجية',
    address_en: 'Sixty Meter Street, outer side',
    hours: { open: '10:00', close: '22:00', days: 'Sat–Thu' },
    menu: [
      ['سماعات لاسلكية', 'Wireless earbuds', 45000],
      ['شاحن سريع', 'Fast charger', 15000],
      ['مروحة كهربائية', 'Electric fan', 60000],
    ],
  },
  {
    key: 'sirwan-home',
    name_ar: 'سيروان للأدوات المنزلية',
    name_en: 'Sirwan Home Goods',
    category: 'retail',
    building_type: 'shop',
    color: '#8e44ad',
    place: placeBeside('market-street', 0.4, -1, 'shop'),
    description_ar: `أدوات مطبخ ومفروشات. ${DEMO_NOTE_AR}`,
    description_en: `Kitchenware and home furnishings. ${DEMO_NOTE_EN}`,
    address_ar: 'شارع السوق',
    address_en: 'Market Street',
    hours: { open: '09:00', close: '21:00', days: 'Sat–Thu' },
    menu: [
      ['طقم قدور', 'Cookware set', 75000],
      ['سجادة صغيرة', 'Small rug', 40000],
    ],
  },
  {
    key: 'shaqlawa-books',
    name_ar: 'مكتبة شقلاوة',
    name_en: 'Shaqlawa Books',
    category: 'retail',
    building_type: 'shop',
    color: '#16a085',
    place: placeBeside('park-street', 0.33, 1, 'shop'),
    description_ar: `كتب وقرطاسية ولوازم مدرسية. ${DEMO_NOTE_AR}`,
    description_en: `Books, stationery and school supplies. ${DEMO_NOTE_EN}`,
    address_ar: 'شارع الحديقة',
    address_en: 'Park Street',
    hours: { open: '09:00', close: '21:00', days: 'Sat–Thu' },
    menu: [
      ['حقيبة مدرسية', 'School bag', 20000],
      ['دفتر (10 قطع)', 'Notebooks (10)', 6000],
    ],
  },
  {
    key: 'hayat-pharmacy',
    name_ar: 'صيدلية الحياة (محاكاة)',
    name_en: 'Hayat Pharmacy (simulated)',
    category: 'pharmacy',
    building_type: 'shop',
    color: '#0e9f8f',
    place: placeBeside('sixty-meter', 0.31, -1, 'shop'),
    description_ar: `صيدلية افتراضية داخل اللعبة؛ لا تُباع أدوية حقيقية. ${DEMO_NOTE_AR}`,
    description_en: `An in-game pharmacy; no real medicine is sold. ${DEMO_NOTE_EN}`,
    address_ar: 'شارع الستين متري',
    address_en: 'Sixty Meter Street',
    hours: { open: '00:00', close: '23:59', days: 'Daily' },
    menu: [
      ['طرد مستلزمات عناية (وهمي)', 'Care supplies parcel (simulated)', null],
    ],
  },
  {
    key: 'kurdistan-paper',
    name_ar: 'صناعات كردستان الورقية',
    name_en: 'Kurdistan Paper Industries',
    category: 'factories',
    building_type: 'factory',
    color: '#a0522d',
    place: placeBeside('industrial-1', 0.37, 1, 'factory', 10),
    description_ar: `تصنيع ورق التغليف والكرتون المضلّع. ${DEMO_NOTE_AR}`,
    description_en: `Packaging paper and corrugated cardboard. ${DEMO_NOTE_EN}`,
    address_ar: 'الشارع الصناعي الأول',
    address_en: 'Industrial Street 1',
    hours: { open: '07:00', close: '19:00', days: 'Sat–Thu' },
    sign_position: 'roof',
    menu: [
      ['رزمة كرتون مضلع', 'Corrugated board bundle', null],
      ['بكرة ورق تغليف', 'Wrapping paper roll', null],
    ],
  },
  {
    key: 'hawler-packaging',
    name_ar: 'مصنع هولير لتعبئة الأغذية',
    name_en: 'Hawler Food Packaging',
    category: 'industrial',
    building_type: 'factory',
    color: '#7f8c3a',
    place: placeBeside('industrial-1', 0.6, 1, 'factory', 10),
    description_ar: `تعبئة وتغليف المواد الغذائية للمطاعم. ${DEMO_NOTE_AR}`,
    description_en: `Food packing for restaurants and shops. ${DEMO_NOTE_EN}`,
    address_ar: 'الشارع الصناعي الأول',
    address_en: 'Industrial Street 1',
    hours: { open: '06:00', close: '18:00', days: 'Sat–Thu' },
    menu: [['صناديق تغليف طعام', 'Food packaging boxes', null]],
  },
  {
    key: 'tigris-logistics',
    name_ar: 'دجلة للخدمات اللوجستية',
    name_en: 'Tigris Logistics',
    category: 'warehouses',
    building_type: 'warehouse',
    color: '#2c3e50',
    place: placeBeside('industrial-2', 0.4, -1, 'warehouse', 10),
    description_ar: `تخزين وتوزيع للتجار في أربيل. ${DEMO_NOTE_AR}`,
    description_en: `Storage and distribution for Erbil merchants. ${DEMO_NOTE_EN}`,
    address_ar: 'الشارع الصناعي الثاني',
    address_en: 'Industrial Street 2',
    hours: { open: '06:00', close: '22:00', days: 'Daily' },
    sign_size: 'large',
    menu: [['منصة شحن (وهمية)', 'Shipping pallet (simulated)', null]],
  },
  {
    key: 'cold-storage',
    name_ar: 'مخازن الستين المبردة',
    name_en: 'Sixty Cold Storage',
    category: 'warehouses',
    building_type: 'warehouse',
    color: '#2980b9',
    place: placeBeside('warehouse-lane', 0.28, 1, 'warehouse', 10),
    description_ar: `تخزين مبرد للحوم والخضار. ${DEMO_NOTE_AR}`,
    description_en: `Cold storage for meat and produce. ${DEMO_NOTE_EN}`,
    address_ar: 'زقاق المستودعات',
    address_en: 'Warehouse Lane',
    hours: { open: '05:00', close: '20:00', days: 'Daily' },
    menu: [['صندوق مبرد (وهمي)', 'Chilled crate (simulated)', null]],
  },
  {
    key: 'nawroz-holding',
    name_ar: 'شركة نوروز القابضة',
    name_en: 'Nawroz Holding',
    category: 'offices',
    building_type: 'office',
    color: '#34495e',
    place: placeBeside('office-avenue', 0.34, 1, 'office', 10),
    description_ar: `مكتب إداري لشركة استثمار وهمية. ${DEMO_NOTE_AR}`,
    description_en: `Head office of a fictional investment group. ${DEMO_NOTE_EN}`,
    address_ar: 'جادة المكاتب',
    address_en: 'Office Avenue',
    hours: { open: '08:30', close: '17:00', days: 'Sun–Thu' },
    sign_position: 'roof',
    menu: [],
  },
];

interface PackageSeed {
  slug: string;
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
  price_usd: number;
  features: PackageFeature[];
  benefits: PackageBenefits;
  location_limit: number;
  featured_limit: number;
}

export const PACKAGES: PackageSeed[] = [
  {
    slug: 'basic',
    name_ar: 'الحضور الأساسي',
    name_en: 'Basic Presence',
    description_ar: 'ظهور النشاط في عالم اللعبة بشعاره واسمه.',
    description_en: 'Put the business in the game world with its name and logo.',
    price_usd: 15,
    features: [
      { ar: 'ملف تعريفي للنشاط', en: 'Merchant profile' },
      { ar: 'الاسم والشعار', en: 'Business name and logo' },
      { ar: 'موقع واحد على الخريطة', en: 'One configured location' },
      { ar: 'لافتة واجهة أساسية', en: 'Basic storefront signage' },
      { ar: 'التصنيف والتفاصيل الأساسية', en: 'Category and basic details' },
      { ar: 'الأهلية لمهام التوصيل العادية', en: 'Eligible for standard delivery missions' },
    ],
    benefits: {
      highlightMarker: false,
      featuredCard: false,
      enhancedSignage: false,
      brandedMissions: false,
      loadingZoneBranding: false,
      districtSponsor: false,
      analyticsLevel: 'basic',
      signScale: 1,
    },
    location_limit: 0,
    featured_limit: 0,
  },
  {
    slug: 'featured',
    name_ar: 'تاجر مميز',
    name_en: 'Featured Merchant',
    description_ar: 'كل ما في الحضور الأساسي مع إبراز أكبر.',
    description_en: 'Everything in Basic Presence, with stronger visibility.',
    price_usd: 30,
    features: [
      { ar: 'كل ما في الحضور الأساسي', en: 'Everything in Basic Presence' },
      { ar: 'واجهة محسّنة', en: 'Enhanced storefront branding' },
      { ar: 'بطاقة مميزة في الدليل', en: 'Featured directory card' },
      { ar: 'علامة بارزة على الخريطة', en: 'Highlighted map marker' },
      { ar: 'ترتيب مميز', en: 'Featured placement' },
      { ar: 'مهام استلام تحمل العلامة التجارية', en: 'Branded pickup missions' },
    ],
    benefits: {
      highlightMarker: true,
      featuredCard: true,
      enhancedSignage: true,
      brandedMissions: true,
      loadingZoneBranding: false,
      districtSponsor: false,
      analyticsLevel: 'basic',
      signScale: 1.25,
    },
    location_limit: 0,
    featured_limit: 6,
  },
  {
    slug: 'business',
    name_ar: 'راعي الأعمال أو المنطقة',
    name_en: 'Business or District Sponsor',
    description_ar: 'كل ما في التاجر المميز مع رعاية المنطقة وتحليلات موسّعة.',
    description_en: 'Everything in Featured Merchant, plus district sponsorship and expanded analytics.',
    price_usd: 60,
    features: [
      { ar: 'كل ما في التاجر المميز', en: 'Everything in Featured Merchant' },
      { ar: 'حضور تجاري معزّز', en: 'Enhanced branded placement' },
      { ar: 'رعاية اختيارية لمنطقة أو فعالية', en: 'Optional district or event sponsorship' },
      { ar: 'مهام بعلامة تجارية قابلة للضبط', en: 'Configurable branded missions' },
      { ar: 'علامة تجارية اختيارية على منطقة التحميل', en: 'Optional loading-zone branding' },
      { ar: 'تحليلات توضيحية موسّعة', en: 'Expanded illustrative analytics' },
    ],
    benefits: {
      highlightMarker: true,
      featuredCard: true,
      enhancedSignage: true,
      brandedMissions: true,
      loadingZoneBranding: true,
      districtSponsor: true,
      analyticsLevel: 'expanded',
      signScale: 1.5,
    },
    location_limit: 3,
    featured_limit: 3,
  },
];

const CUSTOMER_POINTS = {
  street18: {
    at: kerbPoint('street-18', 0.3, 1),
    ar: 'منزل زبون — شارع 18',
    en: 'Customer home — Street 18',
  },
  parkFlats: {
    at: kerbPoint('park-street', 0.12, -1),
    ar: 'عمارة سكنية — شارع الحديقة',
    en: 'Apartment block — Park Street',
  },
  northVilla: {
    at: kerbPoint('north-link', 0.5, 1),
    ar: 'فيلا — الطريق الشمالي',
    en: 'Villa — North Link',
  },
  mosulFlat: {
    at: kerbPoint('mosul-road', 0.15, 1),
    ar: 'شقة زبون — طريق الموصل',
    en: 'Customer flat — Mosul Road',
  },
};

interface MissionSeed {
  type: MissionType;
  title_ar: string;
  title_en: string;
  from: string;
  to: string | keyof typeof CUSTOMER_POINTS;
  package_ar: string;
  package_en: string;
  time_limit_s: number | null;
  coins: number;
  xp: number;
  branded?: boolean;
}

const MISSIONS: MissionSeed[] = [
  { type: 'restaurant_order', title_ar: 'عشاء عائلي من أبو علي', title_en: 'Family dinner from Abu Ali', from: 'abu-ali', to: 'street18', package_ar: 'كباب أربيلي ×2، دولمة، لبن', package_en: 'Erbil kebab ×2, dolma, ayran', time_limit_s: 300, coins: 70, xp: 80, branded: true },
  { type: 'interior_pickup', title_ar: 'طلب جاهز داخل مطعم أبو علي', title_en: 'Counter pickup inside Abu Ali', from: 'abu-ali', to: 'nawroz-holding', package_ar: 'غداء مكتب (6 وجبات)', package_en: 'Office lunch (6 meals)', time_limit_s: null, coins: 90, xp: 90 },
  { type: 'restaurant_order', title_ar: 'غداء شاورما للمكتب', title_en: 'Shawarma lunch for the office', from: 'nishtiman', to: 'nawroz-holding', package_ar: 'وجبة شاورما عائلية', package_en: 'Family shawarma meal', time_limit_s: 360, coins: 65, xp: 70 },
  { type: 'restaurant_order', title_ar: 'قهوة لفريق زاغروس', title_en: 'Coffee run for Zagros team', from: 'citadel-cafe', to: 'zagros-electronics', package_ar: 'لاتيه ×4، كيك الفستق', package_en: 'Latte ×4, pistachio cake', time_limit_s: 240, coins: 45, xp: 50 },
  { type: 'restaurant_order', title_ar: 'خبز الصباح', title_en: 'Morning bread', from: 'hawler-bakery', to: 'parkFlats', package_ar: 'خبز تنور وكليجة', package_en: 'Tannour bread and klecha', time_limit_s: null, coins: 40, xp: 45 },
  { type: 'restaurant_order', title_ar: 'بيتزا للفيلا', title_en: 'Pizza to the villa', from: 'pizza-sixty', to: 'northVilla', package_ar: 'بيتزا لحم ×2', package_en: 'Meat pizza ×2', time_limit_s: 420, coins: 75, xp: 80 },
  { type: 'retail_parcel', title_ar: 'سلة خضار أسبوعية', title_en: 'Weekly vegetable box', from: 'fresh-market', to: 'mosulFlat', package_ar: 'سلة خضار 5 كغ', package_en: 'Vegetable box 5 kg', time_limit_s: null, coins: 55, xp: 60, branded: true },
  { type: 'retail_parcel', title_ar: 'طلب إلكترونيات', title_en: 'Electronics order', from: 'zagros-electronics', to: 'street18', package_ar: 'سماعات لاسلكية وشاحن', package_en: 'Wireless earbuds and charger', time_limit_s: null, coins: 50, xp: 55 },
  { type: 'retail_parcel', title_ar: 'طرد صيدلية (محاكاة)', title_en: 'Pharmacy parcel (simulated)', from: 'hayat-pharmacy', to: 'parkFlats', package_ar: 'طرد مستلزمات عناية وهمي', package_en: 'Simulated care supplies parcel', time_limit_s: 300, coins: 45, xp: 50 },
  { type: 'b2b_parcel', title_ar: 'كرتون إلى دجلة', title_en: 'Cardboard to Tigris', from: 'kurdistan-paper', to: 'tigris-logistics', package_ar: 'رزمة كرتون مضلع', package_en: 'Corrugated board bundle', time_limit_s: null, coins: 80, xp: 85 },
  { type: 'warehouse_shipment', title_ar: 'توريد للسوق الطازج', title_en: 'Restock for Fresh Market', from: 'tigris-logistics', to: 'fresh-market', package_ar: 'منصة بضائع', package_en: 'Pallet of goods', time_limit_s: null, coins: 110, xp: 110, branded: true },
  { type: 'warehouse_shipment', title_ar: 'لحوم مبردة لأبو علي', title_en: 'Chilled meat for Abu Ali', from: 'cold-storage', to: 'abu-ali', package_ar: 'صندوق مبرد', package_en: 'Chilled crate', time_limit_s: 480, coins: 120, xp: 120 },
  { type: 'document_delivery', title_ar: 'عقود إلى المصنع', title_en: 'Contracts to the paper mill', from: 'nawroz-holding', to: 'kurdistan-paper', package_ar: 'ملف عقود موقّعة', package_en: 'Signed contract folder', time_limit_s: 420, coins: 85, xp: 90 },
  { type: 'b2b_parcel', title_ar: 'علب تغليف للمخبز', title_en: 'Packaging for the bakery', from: 'hawler-packaging', to: 'hawler-bakery', package_ar: 'صناديق تغليف طعام', package_en: 'Food packaging boxes', time_limit_s: null, coins: 95, xp: 95 },
];

const dayOffset = (days: number) => {
  const d = new Date(Date.now() + 3 * 3600_000 + days * 86400_000);
  return d.toISOString().slice(0, 10);
};

const SPONSORSHIPS: { merchant: string; pkg: string; from: number; to: number; notes: string }[] = [
  { merchant: 'abu-ali', pkg: 'featured', from: -10, to: 80, notes: 'Demo placement' },
  { merchant: 'fresh-market', pkg: 'featured', from: -1, to: 29, notes: 'Demo placement' },
  { merchant: 'zagros-electronics', pkg: 'basic', from: -3, to: 27, notes: 'Demo placement' },
  { merchant: 'tigris-logistics', pkg: 'business', from: -20, to: 70, notes: 'Demo district sponsor' },
  { merchant: 'citadel-cafe', pkg: 'featured', from: -60, to: -5, notes: 'Expired demo campaign' },
  { merchant: 'pizza-sixty', pkg: 'featured', from: 7, to: 37, notes: 'Scheduled demo campaign' },
];

/** db/seed-assets: PNG logos and covers rendered by scripts/render-brand-assets.mjs. */
function assetsDir(): string {
  const candidates = [join(process.cwd(), 'db', 'seed-assets'), join(import.meta.dirname, '..', 'db', 'seed-assets'), join(import.meta.dirname, '..', '..', 'db', 'seed-assets')];
  const found = candidates.find((d) => existsSync(join(d, 'brands.json')));
  if (!found) throw new Error('db/seed-assets not found');
  return found;
}

async function insertPng(tx: Tx, file: string): Promise<string> {
  const buf = readFileSync(file);
  const { rows } = await tx.query(
    'INSERT INTO images(mime, bytes, size, sha256, width, height) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    ['image/png', buf, buf.length, sha256(buf), buf.readUInt32BE(16), buf.readUInt32BE(20)],
  );
  return rows[0].id as string;
}

/** Inserts the full demo dataset. Expects empty data tables. */
export async function seedDemo(tx: Tx) {
  const catIds = new Map<string, number>();
  for (const [i, c] of CATEGORIES.entries()) {
    const { rows } = await tx.query(
      `INSERT INTO categories(slug, name_ar, name_en, default_building_type, color, sort) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [c.slug, c.name_ar, c.name_en, c.default_building_type, c.color, i],
    );
    catIds.set(c.slug, rows[0].id);
  }

  const merchantIds = new Map<string, number>();
  const placements = new Map<string, Placement>();
  const dir = assetsDir();
  const brands = JSON.parse(readFileSync(join(dir, 'brands.json'), 'utf8')) as Record<string, { bg: string }>;
  for (const [i, m] of MERCHANTS.entries()) {
    const logo = await insertPng(tx, join(dir, `${m.key}-logo.png`));
    const cover = await insertPng(tx, join(dir, `${m.key}-cover.png`));
    const brandColor = brands[m.key]?.bg ?? m.color;
    const p = m.place;
    const { rows } = await tx.query(
      `INSERT INTO merchants(code, name_ar, name_en, category_id, description_ar, description_en, address_ar, address_en,
         lat, lng, entrance_lat, entrance_lng, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
         building_type, sign_size, sign_position, brand_color, logo_image_id, cover_image_id, hours,
         phone, website, interior_enabled, is_fictional, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,true,$27)
       RETURNING id`,
      [
        `M-${String(i + 1).padStart(4, '0')}`,
        m.name_ar,
        m.name_en,
        catIds.get(m.category),
        m.description_ar,
        m.description_en,
        m.address_ar,
        m.address_en,
        p.location.lat,
        p.location.lng,
        p.entrance.lat,
        p.entrance.lng,
        p.pickup.lat,
        p.pickup.lng,
        p.dropoff.lat,
        p.dropoff.lng,
        m.building_type,
        m.sign_size ?? 'medium',
        m.sign_position ?? 'front',
        brandColor,
        logo,
        cover,
        JSON.stringify(m.hours),
        '+964 750 000 0000',
        '',
        m.interior ?? false,
        'Seeded demo business',
      ],
    );
    const id = rows[0].id as number;
    merchantIds.set(m.key, id);
    placements.set(m.key, p);
    for (const [k, item] of (m.menu ?? []).entries()) {
      await tx.query(
        `INSERT INTO menu_items(merchant_id, name_ar, name_en, price_iqd, description_ar, description_en, sort) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, item[0], item[1], item[2], item[3] ?? '', item[4] ?? '', k],
      );
    }
  }

  const packageIds = new Map<string, number>();
  for (const [i, p] of PACKAGES.entries()) {
    const { rows } = await tx.query(
      `INSERT INTO packages(slug, name_ar, name_en, description_ar, description_en, price_usd, features, benefits, location_limit, featured_limit, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [p.slug, p.name_ar, p.name_en, p.description_ar, p.description_en, p.price_usd, JSON.stringify(p.features), JSON.stringify(p.benefits), p.location_limit, p.featured_limit, i],
    );
    packageIds.set(p.slug, rows[0].id);
  }

  for (const s of SPONSORSHIPS) {
    await tx.query(`INSERT INTO sponsorships(merchant_id, package_id, starts_on, ends_on, notes) VALUES ($1,$2,$3,$4,$5)`, [
      merchantIds.get(s.merchant),
      packageIds.get(s.pkg),
      dayOffset(s.from),
      dayOffset(s.to),
      s.notes,
    ]);
  }

  for (const [i, ms] of MISSIONS.entries()) {
    const origin = placements.get(ms.from)!;
    const customer = CUSTOMER_POINTS[ms.to as keyof typeof CUSTOMER_POINTS];
    const destMerchant = customer ? null : merchantIds.get(ms.to)!;
    const dest = customer ? customer.at : placements.get(ms.to)!.dropoff;
    const route = routeBetween(graph, district, origin.pickup, dest);
    await tx.query(
      `INSERT INTO missions(code, type, title_ar, title_en, origin_merchant_id, destination_merchant_id, destination_lat, destination_lng,
         destination_label_ar, destination_label_en, package_ar, package_en, details, time_limit_s, reward_coins, reward_xp, branded)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        `J-${String(i + 1).padStart(3, '0')}`,
        ms.type,
        ms.title_ar,
        ms.title_en,
        merchantIds.get(ms.from),
        destMerchant,
        customer ? dest.lat : null,
        customer ? dest.lng : null,
        customer?.ar ?? '',
        customer?.en ?? '',
        ms.package_ar,
        ms.package_en,
        JSON.stringify({ seededRouteMetres: Math.round(route.length) }),
        ms.time_limit_s,
        ms.coins,
        ms.xp,
        ms.branded ?? false,
      ],
    );
  }

  await seedDemoAnalytics(tx, [...merchantIds.values()]);
  await tx.query(
    `INSERT INTO app_state(key, value) VALUES ('world_version', to_jsonb((extract(epoch FROM clock_timestamp()) * 1000)::bigint)), ('seeded_at', to_jsonb(now()))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );
}

/** Illustrative history so the analytics screen is not empty on first open. Marked is_demo. */
async function seedDemoAnalytics(tx: Tx, merchantIds: number[]) {
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const types: string[] = [];
  const merchants: number[] = [];
  const times: string[] = [];
  for (const id of merchantIds) {
    const weight = 0.6 + rand() * 1.4;
    for (let day = 1; day <= 14; day++) {
      const counts: [string, number][] = [
        ['profile_view', Math.round((4 + rand() * 18) * weight)],
        ['map_discovery', Math.round((2 + rand() * 8) * weight)],
        ['mission_offer', Math.round((3 + rand() * 10) * weight)],
        ['mission_accept', Math.round((1 + rand() * 5) * weight)],
        ['mission_complete', Math.round((rand() * 4) * weight)],
      ];
      for (const [type, n] of counts) {
        for (let k = 0; k < n; k++) {
          types.push(type);
          merchants.push(id);
          times.push(new Date(Date.now() - day * 86400_000 + Math.floor(rand() * 86400_000)).toISOString());
        }
      }
    }
  }
  await tx.query(
    `INSERT INTO analytics_events(type, merchant_id, is_demo, created_at)
     SELECT t, m, true, c FROM unnest($1::text[], $2::int[], $3::timestamptz[]) AS x(t, m, c)`,
    [types, merchants, times],
  );
}

const DATA_TABLES = [
  'analytics_events',
  'player_discoveries',
  'player_achievements',
  'rewards',
  'mission_runs',
  'players',
  'missions',
  'sponsorships',
  'packages',
  'menu_items',
  'merchant_gallery',
  'merchants',
  'images',
  'categories',
  'app_state',
];

/** Deletes all game and merchant data (never admin accounts or the audit log) and re-seeds. */
export async function resetDemo(db: Db, adminId: number | null) {
  await withTx(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(727275)');
    await tx.query(`TRUNCATE ${DATA_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    await seedDemo(tx);
    await tx.query(`INSERT INTO audit_log(admin_id, action, entity, details) VALUES ($1, 'demo.reset', 'system', '{}')`, [adminId]);
  });
}

export async function seedIfEmpty(db: Db): Promise<boolean> {
  return withTx(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(727275)');
    const { rows } = await tx.query('SELECT (SELECT count(*) FROM merchants) + (SELECT count(*) FROM categories) AS n');
    if (Number(rows[0].n) > 0) return false;
    await seedDemo(tx);
    return true;
  });
}
