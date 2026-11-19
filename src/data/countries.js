/**
 * Liste complète de tous les pays du monde (ISO 3166-1 alpha-2) en français avec drapeaux emoji.
 */
const ISO_COUNTRY_CODES = [
  'AF','ZA','AL','DZ','DE','AD','AO','AI','AQ','AG','SA','AR','AM','AW','AU','AT','AZ',
  'BS','BH','BD','BB','BY','BE','BZ','BJ','BM','BT','BO','BA','BW','BR','BN','BG','BF','BI',
  'KH','CM','CA','CV','CL','CN','CY','CO','KM','CG','CD','KP','KR','CR','CI','HR','CU','CW',
  'DK','DJ','DM','EG','AE','EC','ER','ES','EE','SZ','US','ET',
  'FJ','FI','FR',
  'GA','GM','GE','GH','GI','GR','GD','GL','GP','GU','GT','GG','GN','GQ','GW','GY','GF',
  'HT','HN','HK','HU',
  'IN','ID','IQ','IR','IE','IS','IL','IT',
  'JM','JP','JE','JO',
  'KZ','KE','KG','KI','XK','KW',
  'LA','LS','LV','LB','LR','LY','LI','LT','LU',
  'MO','MK','MG','MY','MW','MV','ML','MT','MA','MQ','MU','MR','YT','MX','FM','MD','MC','MN','ME','MS','MZ','MM',
  'NA','NR','NP','NI','NE','NG','NU','NO','NC','NZ',
  'OM','UG','UZ',
  'PK','PW','PS','PA','PG','PY','NL','PE','PH','PL','PF','PR','PT',
  'QA','RE','RO','GB','RU','RW',
  'BL','KN','SM','MF','PM','VC','LC','SV','WS','AS','ST','SN','RS','SC','SL','SG','SX','SK','SI','SO','SD','SS','LK','SE','CH','SR','SJ','SY',
  'TJ','TW','TZ','TD','CZ','TF','TH','TL','TG','TK','TO','TT','TN','TM','TC','TR','TV',
  'UA','UY','VU','VA','VE','VG','VI','VN','WF','YE','ZM','ZW',
];

export function countryCodeToFlag(code) {
  const upper = String(code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return '🌍';
  return String.fromCodePoint(...upper.split('').map((c) => 127397 + c.charCodeAt(0)));
}

function buildCountriesList() {
  let displayNames = null;
  try {
    if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
      displayNames = new Intl.DisplayNames(['fr'], { type: 'region' });
    }
  } catch {
    displayNames = null;
  }

  const seen = new Set();
  const list = [];
  for (const code of ISO_COUNTRY_CODES) {
    if (seen.has(code)) continue;
    seen.add(code);
    let name = code;
    try {
      if (displayNames) {
        const resolved = displayNames.of(code);
        if (resolved && resolved !== code) name = resolved;
      }
    } catch {
      /* keep code */
    }
    list.push({
      code,
      name,
      flag: countryCodeToFlag(code),
    });
  }

  list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return list;
}

export const ALL_COUNTRIES = buildCountriesList();

export function getCountryByCode(code) {
  const upper = String(code || 'FR').toUpperCase();
  return ALL_COUNTRIES.find((c) => c.code === upper) || {
    code: upper,
    name: upper,
    flag: countryCodeToFlag(upper),
  };
}
