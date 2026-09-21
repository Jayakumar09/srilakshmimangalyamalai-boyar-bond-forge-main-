export interface CountryCodeOption {
  /** ISO 3166-1 alpha-2, e.g. "IN". */
  iso: string;
  /** International calling code with leading +, e.g. "+91". */
  code: string;
  /** Flag emoji derived from the ISO code. */
  flag: string;
}

/**
 * Static country list generated from libphonenumber-js metadata
 * (getCountries()/getCountryCallingCode): every region that has a
 * national calling code. Names are resolved lazily at runtime with
 * Intl.DisplayNames so the bundle stays small and reflects the UI locale.
 */
export const COUNTRY_CODES: CountryCodeOption[] = [
  {
    "iso": "AG",
    "code": "+1",
    "flag": "🇦🇬"
  },
  {
    "iso": "AI",
    "code": "+1",
    "flag": "🇦🇮"
  },
  {
    "iso": "AS",
    "code": "+1",
    "flag": "🇦🇸"
  },
  {
    "iso": "BB",
    "code": "+1",
    "flag": "🇧🇧"
  },
  {
    "iso": "BM",
    "code": "+1",
    "flag": "🇧🇲"
  },
  {
    "iso": "BS",
    "code": "+1",
    "flag": "🇧🇸"
  },
  {
    "iso": "CA",
    "code": "+1",
    "flag": "🇨🇦"
  },
  {
    "iso": "DM",
    "code": "+1",
    "flag": "🇩🇲"
  },
  {
    "iso": "DO",
    "code": "+1",
    "flag": "🇩🇴"
  },
  {
    "iso": "GD",
    "code": "+1",
    "flag": "🇬🇩"
  },
  {
    "iso": "GU",
    "code": "+1",
    "flag": "🇬🇺"
  },
  {
    "iso": "JM",
    "code": "+1",
    "flag": "🇯🇲"
  },
  {
    "iso": "KN",
    "code": "+1",
    "flag": "🇰🇳"
  },
  {
    "iso": "KY",
    "code": "+1",
    "flag": "🇰🇾"
  },
  {
    "iso": "LC",
    "code": "+1",
    "flag": "🇱🇨"
  },
  {
    "iso": "MP",
    "code": "+1",
    "flag": "🇲🇵"
  },
  {
    "iso": "MS",
    "code": "+1",
    "flag": "🇲🇸"
  },
  {
    "iso": "PR",
    "code": "+1",
    "flag": "🇵🇷"
  },
  {
    "iso": "SX",
    "code": "+1",
    "flag": "🇸🇽"
  },
  {
    "iso": "TC",
    "code": "+1",
    "flag": "🇹🇨"
  },
  {
    "iso": "TT",
    "code": "+1",
    "flag": "🇹🇹"
  },
  {
    "iso": "US",
    "code": "+1",
    "flag": "🇺🇸"
  },
  {
    "iso": "VC",
    "code": "+1",
    "flag": "🇻🇨"
  },
  {
    "iso": "VG",
    "code": "+1",
    "flag": "🇻🇬"
  },
  {
    "iso": "VI",
    "code": "+1",
    "flag": "🇻🇮"
  },
  {
    "iso": "KZ",
    "code": "+7",
    "flag": "🇰🇿"
  },
  {
    "iso": "RU",
    "code": "+7",
    "flag": "🇷🇺"
  },
  {
    "iso": "EG",
    "code": "+20",
    "flag": "🇪🇬"
  },
  {
    "iso": "ZA",
    "code": "+27",
    "flag": "🇿🇦"
  },
  {
    "iso": "GR",
    "code": "+30",
    "flag": "🇬🇷"
  },
  {
    "iso": "NL",
    "code": "+31",
    "flag": "🇳🇱"
  },
  {
    "iso": "BE",
    "code": "+32",
    "flag": "🇧🇪"
  },
  {
    "iso": "FR",
    "code": "+33",
    "flag": "🇫🇷"
  },
  {
    "iso": "ES",
    "code": "+34",
    "flag": "🇪🇸"
  },
  {
    "iso": "HU",
    "code": "+36",
    "flag": "🇭🇺"
  },
  {
    "iso": "IT",
    "code": "+39",
    "flag": "🇮🇹"
  },
  {
    "iso": "VA",
    "code": "+39",
    "flag": "🇻🇦"
  },
  {
    "iso": "RO",
    "code": "+40",
    "flag": "🇷🇴"
  },
  {
    "iso": "CH",
    "code": "+41",
    "flag": "🇨🇭"
  },
  {
    "iso": "AT",
    "code": "+43",
    "flag": "🇦🇹"
  },
  {
    "iso": "GB",
    "code": "+44",
    "flag": "🇬🇧"
  },
  {
    "iso": "GG",
    "code": "+44",
    "flag": "🇬🇬"
  },
  {
    "iso": "IM",
    "code": "+44",
    "flag": "🇮🇲"
  },
  {
    "iso": "JE",
    "code": "+44",
    "flag": "🇯🇪"
  },
  {
    "iso": "DK",
    "code": "+45",
    "flag": "🇩🇰"
  },
  {
    "iso": "SE",
    "code": "+46",
    "flag": "🇸🇪"
  },
  {
    "iso": "NO",
    "code": "+47",
    "flag": "🇳🇴"
  },
  {
    "iso": "SJ",
    "code": "+47",
    "flag": "🇸🇯"
  },
  {
    "iso": "PL",
    "code": "+48",
    "flag": "🇵🇱"
  },
  {
    "iso": "DE",
    "code": "+49",
    "flag": "🇩🇪"
  },
  {
    "iso": "PE",
    "code": "+51",
    "flag": "🇵🇪"
  },
  {
    "iso": "MX",
    "code": "+52",
    "flag": "🇲🇽"
  },
  {
    "iso": "CU",
    "code": "+53",
    "flag": "🇨🇺"
  },
  {
    "iso": "AR",
    "code": "+54",
    "flag": "🇦🇷"
  },
  {
    "iso": "BR",
    "code": "+55",
    "flag": "🇧🇷"
  },
  {
    "iso": "CL",
    "code": "+56",
    "flag": "🇨🇱"
  },
  {
    "iso": "CO",
    "code": "+57",
    "flag": "🇨🇴"
  },
  {
    "iso": "VE",
    "code": "+58",
    "flag": "🇻🇪"
  },
  {
    "iso": "MY",
    "code": "+60",
    "flag": "🇲🇾"
  },
  {
    "iso": "AU",
    "code": "+61",
    "flag": "🇦🇺"
  },
  {
    "iso": "CC",
    "code": "+61",
    "flag": "🇨🇨"
  },
  {
    "iso": "CX",
    "code": "+61",
    "flag": "🇨🇽"
  },
  {
    "iso": "ID",
    "code": "+62",
    "flag": "🇮🇩"
  },
  {
    "iso": "PH",
    "code": "+63",
    "flag": "🇵🇭"
  },
  {
    "iso": "NZ",
    "code": "+64",
    "flag": "🇳🇿"
  },
  {
    "iso": "SG",
    "code": "+65",
    "flag": "🇸🇬"
  },
  {
    "iso": "TH",
    "code": "+66",
    "flag": "🇹🇭"
  },
  {
    "iso": "JP",
    "code": "+81",
    "flag": "🇯🇵"
  },
  {
    "iso": "KR",
    "code": "+82",
    "flag": "🇰🇷"
  },
  {
    "iso": "VN",
    "code": "+84",
    "flag": "🇻🇳"
  },
  {
    "iso": "CN",
    "code": "+86",
    "flag": "🇨🇳"
  },
  {
    "iso": "TR",
    "code": "+90",
    "flag": "🇹🇷"
  },
  {
    "iso": "IN",
    "code": "+91",
    "flag": "🇮🇳"
  },
  {
    "iso": "PK",
    "code": "+92",
    "flag": "🇵🇰"
  },
  {
    "iso": "AF",
    "code": "+93",
    "flag": "🇦🇫"
  },
  {
    "iso": "LK",
    "code": "+94",
    "flag": "🇱🇰"
  },
  {
    "iso": "MM",
    "code": "+95",
    "flag": "🇲🇲"
  },
  {
    "iso": "IR",
    "code": "+98",
    "flag": "🇮🇷"
  },
  {
    "iso": "SS",
    "code": "+211",
    "flag": "🇸🇸"
  },
  {
    "iso": "EH",
    "code": "+212",
    "flag": "🇪🇭"
  },
  {
    "iso": "MA",
    "code": "+212",
    "flag": "🇲🇦"
  },
  {
    "iso": "DZ",
    "code": "+213",
    "flag": "🇩🇿"
  },
  {
    "iso": "TN",
    "code": "+216",
    "flag": "🇹🇳"
  },
  {
    "iso": "LY",
    "code": "+218",
    "flag": "🇱🇾"
  },
  {
    "iso": "GM",
    "code": "+220",
    "flag": "🇬🇲"
  },
  {
    "iso": "SN",
    "code": "+221",
    "flag": "🇸🇳"
  },
  {
    "iso": "MR",
    "code": "+222",
    "flag": "🇲🇷"
  },
  {
    "iso": "ML",
    "code": "+223",
    "flag": "🇲🇱"
  },
  {
    "iso": "GN",
    "code": "+224",
    "flag": "🇬🇳"
  },
  {
    "iso": "CI",
    "code": "+225",
    "flag": "🇨🇮"
  },
  {
    "iso": "BF",
    "code": "+226",
    "flag": "🇧🇫"
  },
  {
    "iso": "NE",
    "code": "+227",
    "flag": "🇳🇪"
  },
  {
    "iso": "TG",
    "code": "+228",
    "flag": "🇹🇬"
  },
  {
    "iso": "BJ",
    "code": "+229",
    "flag": "🇧🇯"
  },
  {
    "iso": "MU",
    "code": "+230",
    "flag": "🇲🇺"
  },
  {
    "iso": "LR",
    "code": "+231",
    "flag": "🇱🇷"
  },
  {
    "iso": "SL",
    "code": "+232",
    "flag": "🇸🇱"
  },
  {
    "iso": "GH",
    "code": "+233",
    "flag": "🇬🇭"
  },
  {
    "iso": "NG",
    "code": "+234",
    "flag": "🇳🇬"
  },
  {
    "iso": "TD",
    "code": "+235",
    "flag": "🇹🇩"
  },
  {
    "iso": "CF",
    "code": "+236",
    "flag": "🇨🇫"
  },
  {
    "iso": "CM",
    "code": "+237",
    "flag": "🇨🇲"
  },
  {
    "iso": "CV",
    "code": "+238",
    "flag": "🇨🇻"
  },
  {
    "iso": "ST",
    "code": "+239",
    "flag": "🇸🇹"
  },
  {
    "iso": "GQ",
    "code": "+240",
    "flag": "🇬🇶"
  },
  {
    "iso": "GA",
    "code": "+241",
    "flag": "🇬🇦"
  },
  {
    "iso": "CG",
    "code": "+242",
    "flag": "🇨🇬"
  },
  {
    "iso": "CD",
    "code": "+243",
    "flag": "🇨🇩"
  },
  {
    "iso": "AO",
    "code": "+244",
    "flag": "🇦🇴"
  },
  {
    "iso": "GW",
    "code": "+245",
    "flag": "🇬🇼"
  },
  {
    "iso": "IO",
    "code": "+246",
    "flag": "🇮🇴"
  },
  {
    "iso": "AC",
    "code": "+247",
    "flag": "🇦🇨"
  },
  {
    "iso": "SC",
    "code": "+248",
    "flag": "🇸🇨"
  },
  {
    "iso": "SD",
    "code": "+249",
    "flag": "🇸🇩"
  },
  {
    "iso": "RW",
    "code": "+250",
    "flag": "🇷🇼"
  },
  {
    "iso": "ET",
    "code": "+251",
    "flag": "🇪🇹"
  },
  {
    "iso": "SO",
    "code": "+252",
    "flag": "🇸🇴"
  },
  {
    "iso": "DJ",
    "code": "+253",
    "flag": "🇩🇯"
  },
  {
    "iso": "KE",
    "code": "+254",
    "flag": "🇰🇪"
  },
  {
    "iso": "TZ",
    "code": "+255",
    "flag": "🇹🇿"
  },
  {
    "iso": "UG",
    "code": "+256",
    "flag": "🇺🇬"
  },
  {
    "iso": "BI",
    "code": "+257",
    "flag": "🇧🇮"
  },
  {
    "iso": "MZ",
    "code": "+258",
    "flag": "🇲🇿"
  },
  {
    "iso": "ZM",
    "code": "+260",
    "flag": "🇿🇲"
  },
  {
    "iso": "MG",
    "code": "+261",
    "flag": "🇲🇬"
  },
  {
    "iso": "RE",
    "code": "+262",
    "flag": "🇷🇪"
  },
  {
    "iso": "YT",
    "code": "+262",
    "flag": "🇾🇹"
  },
  {
    "iso": "ZW",
    "code": "+263",
    "flag": "🇿🇼"
  },
  {
    "iso": "NA",
    "code": "+264",
    "flag": "🇳🇦"
  },
  {
    "iso": "MW",
    "code": "+265",
    "flag": "🇲🇼"
  },
  {
    "iso": "LS",
    "code": "+266",
    "flag": "🇱🇸"
  },
  {
    "iso": "BW",
    "code": "+267",
    "flag": "🇧🇼"
  },
  {
    "iso": "SZ",
    "code": "+268",
    "flag": "🇸🇿"
  },
  {
    "iso": "KM",
    "code": "+269",
    "flag": "🇰🇲"
  },
  {
    "iso": "SH",
    "code": "+290",
    "flag": "🇸🇭"
  },
  {
    "iso": "TA",
    "code": "+290",
    "flag": "🇹🇦"
  },
  {
    "iso": "ER",
    "code": "+291",
    "flag": "🇪🇷"
  },
  {
    "iso": "AW",
    "code": "+297",
    "flag": "🇦🇼"
  },
  {
    "iso": "FO",
    "code": "+298",
    "flag": "🇫🇴"
  },
  {
    "iso": "GL",
    "code": "+299",
    "flag": "🇬🇱"
  },
  {
    "iso": "GI",
    "code": "+350",
    "flag": "🇬🇮"
  },
  {
    "iso": "PT",
    "code": "+351",
    "flag": "🇵🇹"
  },
  {
    "iso": "LU",
    "code": "+352",
    "flag": "🇱🇺"
  },
  {
    "iso": "IE",
    "code": "+353",
    "flag": "🇮🇪"
  },
  {
    "iso": "IS",
    "code": "+354",
    "flag": "🇮🇸"
  },
  {
    "iso": "AL",
    "code": "+355",
    "flag": "🇦🇱"
  },
  {
    "iso": "MT",
    "code": "+356",
    "flag": "🇲🇹"
  },
  {
    "iso": "CY",
    "code": "+357",
    "flag": "🇨🇾"
  },
  {
    "iso": "AX",
    "code": "+358",
    "flag": "🇦🇽"
  },
  {
    "iso": "FI",
    "code": "+358",
    "flag": "🇫🇮"
  },
  {
    "iso": "BG",
    "code": "+359",
    "flag": "🇧🇬"
  },
  {
    "iso": "LT",
    "code": "+370",
    "flag": "🇱🇹"
  },
  {
    "iso": "LV",
    "code": "+371",
    "flag": "🇱🇻"
  },
  {
    "iso": "EE",
    "code": "+372",
    "flag": "🇪🇪"
  },
  {
    "iso": "MD",
    "code": "+373",
    "flag": "🇲🇩"
  },
  {
    "iso": "AM",
    "code": "+374",
    "flag": "🇦🇲"
  },
  {
    "iso": "BY",
    "code": "+375",
    "flag": "🇧🇾"
  },
  {
    "iso": "AD",
    "code": "+376",
    "flag": "🇦🇩"
  },
  {
    "iso": "MC",
    "code": "+377",
    "flag": "🇲🇨"
  },
  {
    "iso": "SM",
    "code": "+378",
    "flag": "🇸🇲"
  },
  {
    "iso": "UA",
    "code": "+380",
    "flag": "🇺🇦"
  },
  {
    "iso": "RS",
    "code": "+381",
    "flag": "🇷🇸"
  },
  {
    "iso": "ME",
    "code": "+382",
    "flag": "🇲🇪"
  },
  {
    "iso": "XK",
    "code": "+383",
    "flag": "🇽🇰"
  },
  {
    "iso": "HR",
    "code": "+385",
    "flag": "🇭🇷"
  },
  {
    "iso": "SI",
    "code": "+386",
    "flag": "🇸🇮"
  },
  {
    "iso": "BA",
    "code": "+387",
    "flag": "🇧🇦"
  },
  {
    "iso": "MK",
    "code": "+389",
    "flag": "🇲🇰"
  },
  {
    "iso": "CZ",
    "code": "+420",
    "flag": "🇨🇿"
  },
  {
    "iso": "SK",
    "code": "+421",
    "flag": "🇸🇰"
  },
  {
    "iso": "LI",
    "code": "+423",
    "flag": "🇱🇮"
  },
  {
    "iso": "FK",
    "code": "+500",
    "flag": "🇫🇰"
  },
  {
    "iso": "BZ",
    "code": "+501",
    "flag": "🇧🇿"
  },
  {
    "iso": "GT",
    "code": "+502",
    "flag": "🇬🇹"
  },
  {
    "iso": "SV",
    "code": "+503",
    "flag": "🇸🇻"
  },
  {
    "iso": "HN",
    "code": "+504",
    "flag": "🇭🇳"
  },
  {
    "iso": "NI",
    "code": "+505",
    "flag": "🇳🇮"
  },
  {
    "iso": "CR",
    "code": "+506",
    "flag": "🇨🇷"
  },
  {
    "iso": "PA",
    "code": "+507",
    "flag": "🇵🇦"
  },
  {
    "iso": "PM",
    "code": "+508",
    "flag": "🇵🇲"
  },
  {
    "iso": "HT",
    "code": "+509",
    "flag": "🇭🇹"
  },
  {
    "iso": "BL",
    "code": "+590",
    "flag": "🇧🇱"
  },
  {
    "iso": "GP",
    "code": "+590",
    "flag": "🇬🇵"
  },
  {
    "iso": "MF",
    "code": "+590",
    "flag": "🇲🇫"
  },
  {
    "iso": "BO",
    "code": "+591",
    "flag": "🇧🇴"
  },
  {
    "iso": "GY",
    "code": "+592",
    "flag": "🇬🇾"
  },
  {
    "iso": "EC",
    "code": "+593",
    "flag": "🇪🇨"
  },
  {
    "iso": "GF",
    "code": "+594",
    "flag": "🇬🇫"
  },
  {
    "iso": "PY",
    "code": "+595",
    "flag": "🇵🇾"
  },
  {
    "iso": "MQ",
    "code": "+596",
    "flag": "🇲🇶"
  },
  {
    "iso": "SR",
    "code": "+597",
    "flag": "🇸🇷"
  },
  {
    "iso": "UY",
    "code": "+598",
    "flag": "🇺🇾"
  },
  {
    "iso": "BQ",
    "code": "+599",
    "flag": "🇧🇶"
  },
  {
    "iso": "CW",
    "code": "+599",
    "flag": "🇨🇼"
  },
  {
    "iso": "TL",
    "code": "+670",
    "flag": "🇹🇱"
  },
  {
    "iso": "NF",
    "code": "+672",
    "flag": "🇳🇫"
  },
  {
    "iso": "BN",
    "code": "+673",
    "flag": "🇧🇳"
  },
  {
    "iso": "NR",
    "code": "+674",
    "flag": "🇳🇷"
  },
  {
    "iso": "PG",
    "code": "+675",
    "flag": "🇵🇬"
  },
  {
    "iso": "TO",
    "code": "+676",
    "flag": "🇹🇴"
  },
  {
    "iso": "SB",
    "code": "+677",
    "flag": "🇸🇧"
  },
  {
    "iso": "VU",
    "code": "+678",
    "flag": "🇻🇺"
  },
  {
    "iso": "FJ",
    "code": "+679",
    "flag": "🇫🇯"
  },
  {
    "iso": "PW",
    "code": "+680",
    "flag": "🇵🇼"
  },
  {
    "iso": "WF",
    "code": "+681",
    "flag": "🇼🇫"
  },
  {
    "iso": "CK",
    "code": "+682",
    "flag": "🇨🇰"
  },
  {
    "iso": "NU",
    "code": "+683",
    "flag": "🇳🇺"
  },
  {
    "iso": "WS",
    "code": "+685",
    "flag": "🇼🇸"
  },
  {
    "iso": "KI",
    "code": "+686",
    "flag": "🇰🇮"
  },
  {
    "iso": "NC",
    "code": "+687",
    "flag": "🇳🇨"
  },
  {
    "iso": "TV",
    "code": "+688",
    "flag": "🇹🇻"
  },
  {
    "iso": "PF",
    "code": "+689",
    "flag": "🇵🇫"
  },
  {
    "iso": "TK",
    "code": "+690",
    "flag": "🇹🇰"
  },
  {
    "iso": "FM",
    "code": "+691",
    "flag": "🇫🇲"
  },
  {
    "iso": "MH",
    "code": "+692",
    "flag": "🇲🇭"
  },
  {
    "iso": "KP",
    "code": "+850",
    "flag": "🇰🇵"
  },
  {
    "iso": "HK",
    "code": "+852",
    "flag": "🇭🇰"
  },
  {
    "iso": "MO",
    "code": "+853",
    "flag": "🇲🇴"
  },
  {
    "iso": "KH",
    "code": "+855",
    "flag": "🇰🇭"
  },
  {
    "iso": "LA",
    "code": "+856",
    "flag": "🇱🇦"
  },
  {
    "iso": "BD",
    "code": "+880",
    "flag": "🇧🇩"
  },
  {
    "iso": "TW",
    "code": "+886",
    "flag": "🇹🇼"
  },
  {
    "iso": "MV",
    "code": "+960",
    "flag": "🇲🇻"
  },
  {
    "iso": "LB",
    "code": "+961",
    "flag": "🇱🇧"
  },
  {
    "iso": "JO",
    "code": "+962",
    "flag": "🇯🇴"
  },
  {
    "iso": "SY",
    "code": "+963",
    "flag": "🇸🇾"
  },
  {
    "iso": "IQ",
    "code": "+964",
    "flag": "🇮🇶"
  },
  {
    "iso": "KW",
    "code": "+965",
    "flag": "🇰🇼"
  },
  {
    "iso": "SA",
    "code": "+966",
    "flag": "🇸🇦"
  },
  {
    "iso": "YE",
    "code": "+967",
    "flag": "🇾🇪"
  },
  {
    "iso": "OM",
    "code": "+968",
    "flag": "🇴🇲"
  },
  {
    "iso": "PS",
    "code": "+970",
    "flag": "🇵🇸"
  },
  {
    "iso": "AE",
    "code": "+971",
    "flag": "🇦🇪"
  },
  {
    "iso": "IL",
    "code": "+972",
    "flag": "🇮🇱"
  },
  {
    "iso": "BH",
    "code": "+973",
    "flag": "🇧🇭"
  },
  {
    "iso": "QA",
    "code": "+974",
    "flag": "🇶🇦"
  },
  {
    "iso": "BT",
    "code": "+975",
    "flag": "🇧🇹"
  },
  {
    "iso": "MN",
    "code": "+976",
    "flag": "🇲🇳"
  },
  {
    "iso": "NP",
    "code": "+977",
    "flag": "🇳🇵"
  },
  {
    "iso": "TJ",
    "code": "+992",
    "flag": "🇹🇯"
  },
  {
    "iso": "TM",
    "code": "+993",
    "flag": "🇹🇲"
  },
  {
    "iso": "AZ",
    "code": "+994",
    "flag": "🇦🇿"
  },
  {
    "iso": "GE",
    "code": "+995",
    "flag": "🇬🇪"
  },
  {
    "iso": "KG",
    "code": "+996",
    "flag": "🇰🇬"
  },
  {
    "iso": "UZ",
    "code": "+998",
    "flag": "🇺🇿"
  }
];

export const DEFAULT_COUNTRY_ISO = "IN";

let displayNames: { of: (code: string) => string | undefined } | null = null;

/**
 * English country name for display ("India", "United Arab Emirates", ...).
 * Falls back to the ISO code when Intl.DisplayNames is unavailable.
 */
export function countryName(iso: string): string {
  if (!displayNames) {
    const Ctor = (Intl as unknown as Record<string, unknown>)[
      "DisplayNames"
    ] as (new (locale?: string, opts?: unknown) => { of: (code: string) => string | undefined }) | undefined;
    displayNames = Ctor ? new Ctor("en", { type: "region" }) : null;
  }
  const name = displayNames?.of(iso.toUpperCase());
  return name && name !== iso.toUpperCase() ? name : iso.toUpperCase();
}

export function countryNameCode(iso: string): string {
  return `${countryName(iso)} (${iso})`;
}

