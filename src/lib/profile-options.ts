export type ProfileOption = { v: string; labelKey: string };

export const GENDERS: ProfileOption[] = [
  { v: "Male", labelKey: "male" },
  { v: "Female", labelKey: "female" },
];

export const MARITAL_STATUSES: ProfileOption[] = [
  { v: "Unmarried", labelKey: "unmarried" },
  { v: "Divorced", labelKey: "divorced" },
  { v: "Widowed", labelKey: "widowed" },
];

export const EDUCATION_LEVELS: ProfileOption[] = [
  { v: "No formal schooling", labelKey: "edu_none" },
  { v: "10th", labelKey: "edu_10" },
  { v: "+2", labelKey: "edu_12" },
  { v: "UG Degree", labelKey: "edu_ug" },
  { v: "Professional / PG", labelKey: "edu_pg" },
];

export const CASTE_OPTIONS: ProfileOption[] = [
  { v: "Boyar", labelKey: "caste_boyar" },
];

export const FAMILY_TYPES: ProfileOption[] = [
  { v: "Nuclear", labelKey: "fam_nuclear" },
  { v: "Joint", labelKey: "fam_joint" },
];

export const FAMILY_STATUSES: ProfileOption[] = [
  { v: "Middle class", labelKey: "fam_middle" },
  { v: "Upper middle class", labelKey: "fam_upper" },
  { v: "Affluent", labelKey: "fam_affluent" },
];

export const ID_KINDS: ProfileOption[] = [
  { v: "Aadhaar", labelKey: "id_aadhaar" },
  { v: "PAN", labelKey: "id_pan" },
  { v: "Voter ID", labelKey: "id_voter" },
  { v: "Driving Licence", labelKey: "id_dl" },
];