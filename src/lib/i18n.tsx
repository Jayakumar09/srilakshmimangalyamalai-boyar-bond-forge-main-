import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";

export type Lang = "en" | "ta";

type Dict = Record<string, { en: string; ta: string }>;

export const dict: Dict = {
  brand: { en: "Sri Lakshmi Mangalya Malai", ta: "ஸ்ரீ லட்சுமி மங்கல்ய மாலை" },
  brand_line2: { en: "Boyar Matrimony", ta: "பொயர் திருமண சேவை" },
  brand_badge: { en: "Sri", ta: "ஸ்ரீ" },
  lang_en: { en: "English", ta: "ஆங்கிலம்" },
  lang_ta: { en: "Tamil", ta: "தமிழ்" },
  hero_img_alt: {
    en: "Tamil wedding couple with garlands",
    ta: "மாலைகளுடன் தமிழ் திருமண தம்பதியர்",
  },
  tagline: {
    en: "A verified, admin-approved matrimony service for the Boyar community",
    ta: "பொயர் சமுதாயத்திற்கான சரிபார்க்கப்பட்ட, நிர்வாக ஒப்புதல் பெற்ற திருமண சேவை",
  },
  nav_home: { en: "Home", ta: "முகப்பு" },
  nav_plans: { en: "Plans", ta: "கட்டணத் திட்டங்கள்" },
  nav_login: { en: "Sign in", ta: "உள்நுழைய" },
  nav_register: { en: "Register", ta: "பதிவு செய்க" },
  nav_dashboard: { en: "My account", ta: "என் கணக்கு" },
  nav_admin: { en: "Admin", ta: "நிர்வாகம்" },
  nav_logout: { en: "Sign out", ta: "வெளியேறு" },
  admin_home_title: { en: "Administrator account", ta: "நிர்வாகி கணக்கு" },
  admin_home_d: {
    en: "You manage approvals, payments and horoscope reports. Member registration does not apply to this account.",
    ta: "நீங்கள் அங்கீகாரங்கள், கட்டணங்கள் மற்றும் ஜாதக அறிக்கைகளை நிர்வகிக்கிறீர்கள். உறுப்பினர் பதிவு இந்தக் கணக்குக்குப் பொருந்தாது.",
  },
  admin_open_dashboard: { en: "Open admin dashboard", ta: "நிர்வாகப் பலகையைத் திற" },
  hero_cta: { en: "Create your profile", ta: "உங்கள் சுயவிவரத்தை உருவாக்கவும்" },
  hero_secondary: { en: "How verification works", ta: "சரிபார்ப்பு எப்படி நடக்கிறது" },
  hero_note: {
    en: "Every profile is checked by our team. Government ID and a clear photo are mandatory.",
    ta: "ஒவ்வொரு சுயவிவரமும் எங்கள் குழுவால் சரிபார்க்கப்படுகிறது. அரசு அடையாள அட்டை மற்றும் தெளிவான புகைப்படம் கட்டாயம்.",
  },
  trust_1_t: { en: "ID verified", ta: "அடையாளம் சரிபார்க்கப்பட்டது" },
  trust_1_d: {
    en: "Aadhaar, PAN, Voter ID or Driving Licence checked against your photo.",
    ta: "ஆதார், பான், வாக்காளர் அட்டை அல்லது ஓட்டுநர் உரிமம் உங்கள் புகைப்படத்துடன் சரிபார்க்கப்படும்.",
  },
  trust_2_t: { en: "Admin approved", ta: "நிர்வாக ஒப்புதல்" },
  trust_2_d: {
    en: "No profile goes live and nobody can browse matches without our approval.",
    ta: "எங்கள் ஒப்புதல் இல்லாமல் எந்த சுயவிவரமும் வெளியாகாது, பொருத்தங்களைப் பார்க்கவும் முடியாது.",
  },
  trust_3_t: { en: "Community first", ta: "சமுதாயம் முதலில்" },
  trust_3_d: {
    en: "Built only for Boyar families, in Tamil and English.",
    ta: "பொயர் குடும்பங்களுக்காக மட்டுமே, தமிழ் மற்றும் ஆங்கிலத்தில்.",
  },
  plans_title: { en: "Membership plans", ta: "உறுப்பினர் திட்டங்கள்" },
  plans_sub: {
    en: "One year validity, subject to admin approval. All payments are final and non-refundable.",
    ta: "ஒரு வருட செல்லுபடி, நிர்வாக ஒப்புதலுக்கு உட்பட்டது. அனைத்து கட்டணங்களும் இறுதியானவை, திரும்பப் பெற முடியாது.",
  },
  plan_free: { en: "Community Starter", ta: "சமுதாய தொடக்கம்" },
  plan_free_d: {
    en: "Profile creation, ID upload, browsing and receiving interests.",
    ta: "சுயவிவரம் உருவாக்கம், அடையாள பதிவேற்றம், உலாவுதல் மற்றும் விருப்பங்களைப் பெறுதல்.",
  },
  plan_std: { en: "Standard Plan", ta: "சாதாரண திட்டம்" },
  plan_std_d: {
    en: "For UG degree holders, +2, 10th pass or non-schooled members.",
    ta: "இளநிலை பட்டதாரிகள், +2, 10ஆம் வகுப்பு அல்லது பள்ளிக்கல்வி இல்லாதவர்களுக்கு.",
  },
  plan_prem: { en: "Premium Plan", ta: "பிரீமியம் திட்டம்" },
  plan_prem_d: {
    en: "For professional degree holders — Engineering, Medical, Post-graduates.",
    ta: "தொழில்முறை பட்டதாரிகளுக்கு — பொறியியல், மருத்துவம், முதுநிலை.",
  },
  jathagam: { en: "Jathagam (horoscope) report", ta: "ஜாதகம் அறிக்கை" },
  jathagam_d: {
    en: "Add-on service prepared by our astrologer and delivered as a PDF.",
    ta: "எங்கள் ஜோதிடரால் தயாரிக்கப்பட்டு PDF ஆக வழங்கப்படும் கூடுதல் சேவை.",
  },
  year: { en: "/ year", ta: "/ ஆண்டு" },
  // auth
  auth_title: { en: "Member sign in", ta: "உறுப்பினர் உள்நுழைவு" },
  auth_signup: { en: "Create an account", ta: "கணக்கை உருவாக்கவும்" },
  email: { en: "Email", ta: "மின்னஞ்சல்" },
  password: { en: "Password", ta: "கடவுச்சொல்" },
  full_name: { en: "Full name", ta: "முழுப் பெயர்" },
  have_account: { en: "Already have an account? Sign in", ta: "ஏற்கனவே கணக்கு உள்ளதா? உள்நுழைக" },
  no_account: { en: "New here? Create an account", ta: "புதியவரா? கணக்கை உருவாக்குங்கள்" },
  auth_forgot: { en: "Forgot password?", ta: "கடவுச்சொல் மறந்துவிட்டதா?" },
  auth_forgot_sent: {
    en: "If this email has an account, a password reset link has been sent. Please check your inbox.",
    ta: "இந்த மின்னஞ்சலில் கணக்கு இருந்தால், கடவுச்சொல் மீட்டமைப்பு இணைப்பு அனுப்பப்பட்டுள்ளது. உங்கள் இன்பாக்ஸைச் சரிபார்க்கவும்.",
  },
  auth_forgot_missing_email: {
    en: "Enter your email address first.",
    ta: "முதலில் உங்கள் மின்னஞ்சல் முகவரியை உள்ளிடவும்.",
  },
  // password reset
  reset_title: { en: "Reset your password", ta: "கடவுச்சொல்லை மீட்டமைக்கவும்" },
  reset_hint: {
    en: "Choose a new password for your account.",
    ta: "உங்கள் கணக்கிற்கான புதிய கடவுச்சொல்லைத் தேர்ந்தெடுக்கவும்.",
  },
  reset_new_password: { en: "New password", ta: "புதிய கடவுச்சொல்" },
  reset_confirm_password: { en: "Confirm password", ta: "கடவுச்சொல்லை உறுதிப்படுத்தவும்" },
  reset_submit: { en: "Set new password", ta: "புதிய கடவுச்சொல்லை அமைக்கவும்" },
  reset_success: {
    en: "Password updated. You are signed in.",
    ta: "கடவுச்சொல் புதுப்பிக்கப்பட்டது. நீங்கள் உள்நுழைந்துள்ளீர்கள்.",
  },
  reset_failed: {
    en: "Could not update the password.",
    ta: "கடவுச்சொல்லைப் புதுப்பிக்க முடியவில்லை.",
  },
  reset_pwds_mismatch: {
    en: "Passwords must match and be at least 8 characters long.",
    ta: "கடவுச்சொற்கள் ஒத்திருக்க வேண்டும், குறைந்தது 8 எழுத்துகள் இருக்க வேண்டும்.",
  },
  reset_invalid: {
    en: "This reset link is invalid or has expired.",
    ta: "இந்த மீட்டமைப்பு இணைப்பு தவறானது அல்லது காலாவதியாகிவிட்டது.",
  },
  reset_back: { en: "Back to sign in", ta: "உள்நுழைவுக்குத் திரும்பு" },
  show_password: { en: "Show password", ta: "கடவுச்சொல்லைக் காட்டு" },
  hide_password: { en: "Hide password", ta: "கடவுச்சொல்லை மறை" },
  // registration
  reg_title: { en: "Registration", ta: "பதிவு" },
  step_basic: { en: "Basic details", ta: "அடிப்படை விவரங்கள்" },
  step_contact: { en: "Contact", ta: "தொடர்பு" },
  step_edu: { en: "Education & career", ta: "கல்வி மற்றும் பணி" },
  step_family: { en: "Family", ta: "குடும்பம்" },
  step_pref: { en: "Partner preferences", ta: "வாழ்க்கைத் துணை விருப்பம்" },
  step_docs: { en: "Documents & verification", ta: "ஆவணங்கள் மற்றும் சரிபார்ப்பு" },
  gender: { en: "Gender", ta: "பாலினம்" },
  male: { en: "Male", ta: "ஆண்" },
  female: { en: "Female", ta: "பெண்" },
  dob: { en: "Date of birth", ta: "பிறந்த தேதி" },
  marital_status: { en: "Marital status", ta: "திருமண நிலை" },
  unmarried: { en: "Unmarried", ta: "திருமணமாகாதவர்" },
  divorced: { en: "Divorced", ta: "விவாகரத்து பெற்றவர்" },
  widowed: { en: "Widowed", ta: "விதவை / மனைவியை இழந்தவர்" },
  sub_caste: { en: "Sub-caste", ta: "உட்பிரிவு" },
  caste: { en: "Caste", ta: "சாதி" },
  caste_boyar: { en: "Boyar", ta: "போயர்" },
  gothram: { en: "Gothram", ta: "கோத்திரம்" },
  mother_tongue: { en: "Mother tongue", ta: "தாய்மொழி" },
  height: { en: "Height (cm)", ta: "உயரம் (செ.மீ)" },
  weight: { en: "Weight (kg)", ta: "எடை (கிலோ)" },
  phone: { en: "Mobile number", ta: "கைபேசி எண்" },
  whatsapp: { en: "WhatsApp number", ta: "வாட்ஸ்அப் எண்" },
  phone_invalid: {
    en: "Enter a valid Indian mobile number (e.g. +91 98765 43210)",
    ta: "சரியான இந்திய கைபேசி எண்ணை உள்ளிடவும் (எ.கா. +91 98765 43210)",
  },
  phone_general: { en: "General contact", ta: "பொது தொடர்பு" },
  phone_whatsapp_only: { en: "WhatsApp calls only", ta: "வாட்ஸ்அப் அழைப்புகள் மட்டும்" },
  address: { en: "Address", ta: "முகவரி" },
  city: { en: "Town / City", ta: "ஊர் / நகரம்" },
  district: { en: "Native district", ta: "சொந்த மாவட்டம்" },
  state: { en: "State", ta: "மாநிலம்" },
  pincode: { en: "Pincode", ta: "அஞ்சல் குறியீடு" },
  education_level: { en: "Education level", ta: "கல்வி நிலை" },
  education_detail: { en: "Course", ta: "படிப்பு" },
  profession: { en: "Profession", ta: "தொழில்" },
  any_profession: { en: "Any Profession", ta: "எந்த தொழில்" },
  job_detail: { en: "Job details", ta: "பணி விவரம்" },
  income: { en: "Annual income", ta: "ஆண்டு வருமானம்" },
  father_name: { en: "Father's name", ta: "தந்தையின் பெயர்" },
  father_occ: { en: "Father's occupation", ta: "தந்தையின் தொழில்" },
  mother_name: { en: "Mother's name", ta: "தாயின் பெயர்" },
  mother_occ: { en: "Mother's occupation", ta: "தாயின் தொழில்" },
  siblings: { en: "Brothers / sisters", ta: "சகோதர சகோதரிகள்" },
  brothers: { en: "Brothers", ta: "சகோதரர்கள்" },
  sisters: { en: "Sisters", ta: "சகோதரிகள்" },
  family_type: { en: "Family type", ta: "குடும்ப வகை" },
  family_status: { en: "Family status", ta: "குடும்ப நிலை" },
  family_details: { en: "Other family details", ta: "பிற குடும்ப விவரங்கள்" },
  pref_age: { en: "Preferred age range", ta: "விரும்பும் வயது வரம்பு" },
  pref_height: { en: "Minimum height (cm)", ta: "குறைந்தபட்ச உயரம் (செ.மீ)" },
  pref_notes: { en: "Other expectations", ta: "பிற எதிர்பார்ப்புகள்" },
  birth_time: { en: "Birth time", ta: "பிறந்த நேரம்" },
  time_invalid: { en: "Enter a valid time (e.g. 06:30 AM)", ta: "சரியான நேரத்தை உள்ளிடவும் (எ.கா. 06:30 AM)" },
  hour: { en: "Hour", ta: "மணி" },
  minute: { en: "Minute", ta: "நிமிடம்" },
  time_period: { en: "AM/PM", ta: "AM/PM" },
  other: { en: "Other", ta: "மற்றவை" },
  other_pick_from_list: { en: "← Choose from the list", ta: "← பட்டியலிலிருந்து தேர்ந்தெடுக்கவும்" },
  msg_img_decode_failed: {
    en: "This image could not be read. Please upload a valid JPG or PNG image.",
    ta: "இந்தப் படத்தைப் படிக்க முடியவில்லை. சரியான JPG அல்லது PNG படத்தைப் பதிவேற்றவும்.",
  },
  msg_pdf_invalid: {
    en: "This PDF could not be read. Please upload a valid PDF file.",
    ta: "இந்த PDF-ஐப் படிக்க முடியவில்லை. சரியான PDF கோப்பைப் பதிவேற்றவும்.",
  },
  msg_file_unsupported: {
    en: "Unsupported file type. Please upload JPG, PNG, or PDF.",
    ta: "ஆதரிக்கப்படாத கோப்பு வகை. JPG, PNG அல்லது PDF-ஐப் பதிவேற்றவும்.",
  },
  msg_pdf_ai_skip: {
    en: "The AI pre-check runs on image scans only; your PDF will be reviewed manually by the admin.",
    ta: "AI முன் சரிபார்ப்பு பட ஸ்கேன்களுக்கு மட்டும்; உங்கள் PDF நிர்வாகியால் கைமுறையாக ஆய்வு செய்யப்படும்.",
  },
  birth_place: { en: "Birth place", ta: "பிறந்த இடம்" },
  about: { en: "About yourself", ta: "உங்களைப் பற்றி" },
  photo: { en: "Clear profile photo", ta: "தெளிவான புகைப்படம்" },
  govt_id: { en: "Government ID", ta: "அரசு அடையாள அட்டை" },
  id_kind: { en: "ID type", ta: "அடையாள வகை" },
  divorce_doc: { en: "Court divorce certificate", ta: "நீதிமன்ற விவாகரத்து சான்றிதழ்" },
  divorce_doc_note: {
    en: "Mandatory for divorced or widowed applicants.",
    ta: "விவாகரத்து அல்லது துணையை இழந்தவர்களுக்கு கட்டாயம்.",
  },
  ai_check: { en: "Run AI pre-check", ta: "AI முன் சரிபார்ப்பு" },
  ai_running: { en: "Checking your documents…", ta: "உங்கள் ஆவணங்கள் சரிபார்க்கப்படுகின்றன…" },
  consent: {
    en: "I have read and accept the Terms & Conditions, Privacy Policy and the strict No-Refund Policy. I confirm all information and documents I submit are true.",
    ta: "நான் விதிமுறைகள், தனியுரிமைக் கொள்கை மற்றும் பணம் திரும்பப் பெற முடியாத கொள்கையை படித்து ஏற்கிறேன். நான் அளிக்கும் தகவல்கள் மற்றும் ஆவணங்கள் உண்மையானவை என உறுதி செய்கிறேன்.",
  },
  submit_review: { en: "Submit for admin approval", ta: "நிர்வாக ஒப்புதலுக்கு அனுப்பவும்" },
  next: { en: "Next", ta: "அடுத்து" },
  back: { en: "Back", ta: "பின்" },
  save: { en: "Save", ta: "சேமி" },
  saved: { en: "Saved", ta: "சேமிக்கப்பட்டது" },
  type_to_add: {
    en: "Type to search or add new",
    ta: "தேட அல்லது புதிதாக சேர்க்க தட்டச்சு செய்யவும்",
  },
  add_new: { en: "Add", ta: "சேர்" },
  cancel: { en: "Cancel", ta: "ரத்து" },
  custom_value_required: { en: "Please enter a value", ta: "மதிப்பை உள்ளிடவும்" },
  enter_new_item: { en: "Enter new item", ta: "புதிய உருப்படியை உள்ளிடவும்" },
  enter_new_occupation: { en: "Enter new occupation", ta: "புதிய தொழிலை உள்ளிடவும்" },
  enter_new_sub_caste: { en: "Enter new Sub-caste", ta: "புதிய துணைச் சாதியை உள்ளிடவும்" },
  enter_new_profession: { en: "Enter new profession", ta: "புதிய தொழிலை உள்ளிடவும்" },
  enter_new_gothram: { en: "Enter new Gothram / Kulam", ta: "புதிய கோத்ரம் / குலத்தை உள்ளிடவும்" },
  enter_new_mother_tongue: { en: "Enter new mother tongue", ta: "புதிய தாய்மொழியை உள்ளிடவும்" },
  enter_new_job_details: { en: "Enter new job details", ta: "புதிய வேலை விவரங்களை உள்ளிடவும்" },
  // dashboard
  status_pending: { en: "Waiting for admin approval", ta: "நிர்வாக ஒப்புதலுக்காக காத்திருக்கிறது" },
  status_pending_d: {
    en: "Our team is verifying your ID and photo. You will be able to browse matches once approved.",
    ta: "எங்கள் குழு உங்கள் அடையாளம் மற்றும் புகைப்படத்தைச் சரிபார்க்கிறது. ஒப்புதலுக்குப் பிறகு பொருத்தங்களைப் பார்க்கலாம்.",
  },
  status_approved: { en: "Profile approved", ta: "சுயவிவரம் அங்கீகரிக்கப்பட்டது" },
  my_profile: { en: "My profile", ta: "என் சுயவிவரம்" },
  edit_profile: { en: "Edit profile", ta: "சுயவிவரத்தைத் திருத்து" },
  print_profile: { en: "Print", ta: "அச்சிடு" },
  draft_saved: {
    en: "Saved, not submitted yet",
    ta: "சேமிக்கப்பட்டது, இன்னும் சமர்ப்பிக்கப்படவில்லை",
  },
  draft_saved_d: {
    en: "Your details are saved. Finish the remaining steps and submit to send your profile for admin approval.",
    ta: "உங்கள் விவரங்கள் சேமிக்கப்பட்டுள்ளன. மீதமுள்ள படிகளை நிறைவு செய்து, நிர்வாக ஒப்புதலுக்கு சமர்ப்பிக்கவும்.",
  },
  continue_reg: { en: "Continue registration", ta: "பதிவைத் தொடரவும்" },
  status_rejected: { en: "Profile not approved", ta: "சுயவிவரம் ஏற்கப்படவில்லை" },
  // admin
  admin_queue: { en: "Approval queue", ta: "ஒப்புதல் வரிசை" },
  approve: { en: "Approve", ta: "ஒப்புதல்" },
  reject: { en: "Reject", ta: "நிராகரி" },
  admin_notes: { en: "Admin note", ta: "நிர்வாக குறிப்பு" },
  no_pending: { en: "No profiles waiting.", ta: "காத்திருக்கும் சுயவிவரங்கள் இல்லை." },
  // legal
  terms: { en: "Terms & Conditions", ta: "விதிமுறைகள் மற்றும் நிபந்தனைகள்" },
  privacy: { en: "Privacy Policy", ta: "தனியுரிமைக் கொள்கை" },
  refund: { en: "Cancellation & Refund Policy", ta: "ரத்து மற்றும் பணத்திரும்பக் கொள்கை" },
  contact: { en: "Contact", ta: "தொடர்பு" },
  rights: { en: "All rights reserved.", ta: "அனைத்து உரிமைகளும் பாதுகாக்கப்பட்டவை." },
  // navigation / app
  nav_matches: { en: "Find matches", ta: "பொருத்தங்கள்" },
  nav_messages: { en: "Messages", ta: "செய்திகள்" },
  nav_member_messages: { en: "Member Messages", ta: "உறுப்பினர் செய்திகள்" },
  nav_communication: { en: "Communication", ta: "தொடர்பு" },
  nav_payments: { en: "Payments", ta: "கட்டணம்" },
  // checkout
  checkout_title: { en: "Activate your plan", ta: "உங்கள் திட்டத்தை செயல்படுத்துங்கள்" },
  checkout_sub: {
    en: "Pay online for instant activation, or transfer by UPI and submit the UTR reference for admin verification.",
    ta: "உடனடி செயல்பாட்டிற்கு ஆன்லைனில் செலுத்துங்கள், அல்லது UPI மூலம் அனுப்பி UTR குறிப்பு எண்ணை நிர்வாக சரிபார்ப்புக்கு சமர்ப்பியுங்கள்.",
  },
  pay_online: { en: "Pay online (UPI / card)", ta: "ஆன்லைனில் செலுத்து (UPI / கார்டு)" },
  pay_manual: { en: "I paid by UPI / bank transfer", ta: "UPI / வங்கி மூலம் செலுத்திவிட்டேன்" },
  utr: { en: "UTR / reference number", ta: "UTR / குறிப்பு எண்" },
  payment_proof: { en: "Payment screenshot", ta: "கட்டண திரைப்பிடிப்பு" },
  submit_payment: { en: "Submit for verification", ta: "சரிபார்ப்புக்கு சமர்ப்பி" },
  payment_submitted: {
    en: "Payment submitted. Your plan activates once the admin verifies it.",
    ta: "கட்டணம் சமர்ப்பிக்கப்பட்டது. நிர்வாகம் சரிபார்த்தவுடன் திட்டம் செயல்படும்.",
  },
  payment_verified: { en: "Verified", ta: "சரிபார்க்கப்பட்டது" },
  my_payments: { en: "My payments", ta: "என் கட்டணங்கள்" },
  jathagam_details: { en: "Birth details for Jathagam", ta: "ஜாதகத்திற்கான பிறப்பு விவரங்கள்" },
  download_report: { en: "Download report", ta: "அறிக்கையைப் பதிவிறக்கு" },
  // matches
  matches_title: { en: "Find matches", ta: "பொருத்தங்களைத் தேடுங்கள்" },
  matches_locked: {
    en: "Matches open once your profile is approved by the admin.",
    ta: "நிர்வாக ஒப்புதலுக்குப் பிறகு பொருத்தங்கள் திறக்கப்படும்.",
  },
  search: { en: "Search", ta: "தேடு" },
  clear: { en: "Clear", ta: "அழி" },
  any: { en: "Any", ta: "அனைத்தும்" },
  age_from: { en: "Age from", ta: "வயது முதல்" },
  age_to: { en: "Age to", ta: "வயது வரை" },
  shortlist: { en: "Shortlist", ta: "பட்டியலில் சேர்" },
  shortlisted: { en: "Shortlisted", ta: "சேர்க்கப்பட்டது" },
  block: { en: "Block", ta: "தடு" },
  report: { en: "Report", ta: "புகார்" },
  message: { en: "Message", ta: "செய்தி" },
  no_results: { en: "No profiles match this search.", ta: "இந்தத் தேடலுக்கு சுயவிவரங்கள் இல்லை." },
  upgrade_to_message: {
    en: "Messaging is available on the Standard and Premium plans.",
    ta: "சாதாரண மற்றும் பிரீமியம் திட்டங்களில் செய்தி அனுப்பலாம்.",
  },
  // messages
  messages_title: { en: "Messages", ta: "செய்திகள்" },
  no_conversations: { en: "No conversations yet.", ta: "இதுவரை உரையாடல்கள் இல்லை." },
  type_message: { en: "Write a message…", ta: "செய்தியை எழுதுங்கள்…" },
  send: { en: "Send", ta: "அனுப்பு" },
  // admin
  admin_payments: { en: "Payments", ta: "கட்டணங்கள்" },
  admin_jathagam: { en: "Jathagam requests", ta: "ஜாதக கோரிக்கைகள்" },
  admin_reports: { en: "Reports & blocks", ta: "புகார்கள் மற்றும் தடைகள்" },
  admin_alerts: { en: "Alerts", ta: "அறிவிப்புகள்" },
  upload_report: { en: "Upload horoscope PDF", ta: "ஜாதக PDF பதிவேற்று" },
  mark_verified: { en: "Mark verified", ta: "சரிபார்க்கப்பட்டது எனக் குறி" },
  // registration option labels
  edu_none: { en: "No formal schooling", ta: "பள்ளிக்கல்வி இல்லை" },
  edu_10: { en: "10th", ta: "10ஆம் வகுப்பு" },
  edu_12: { en: "+2", ta: "+2" },
  edu_ug: { en: "UG Degree", ta: "இளநிலை பட்டம்" },
  edu_pg: { en: "Professional / PG", ta: "தொழில்முறை / முதுநிலை" },
  fam_nuclear: { en: "Nuclear", ta: "தனிக் குடும்பம்" },
  fam_joint: { en: "Joint", ta: "கூட்டுக் குடும்பம்" },
  fam_middle: { en: "Middle class", ta: "நடுத்தர வர்க்கம்" },
  fam_upper: { en: "Upper middle class", ta: "உயர் நடுத்தர வர்க்கம்" },
  fam_affluent: { en: "Affluent", ta: "வசதி படைத்தவர்" },
  id_aadhaar: { en: "Aadhaar", ta: "ஆதார்" },
  id_pan: { en: "PAN", ta: "பான்" },
  id_voter: { en: "Voter ID", ta: "வாக்காளர் அட்டை" },
  id_dl: { en: "Driving Licence", ta: "ஓட்டுநர் உரிமம்" },
  choose_file: { en: "Choose a file", ta: "கோப்பைத் தேர்ந்தெடுக்கவும்" },
  min_label: { en: "min", ta: "குறைந்தபட்சம்" },
  max_label: { en: "max", ta: "அதிகபட்சம்" },
  yes: { en: "Yes", ta: "ஆம்" },
  no: { en: "No", ta: "இல்லை" },
  ai_face_match: { en: "Face match", ta: "முக பொருத்தம்" },
  ai_id_readable: { en: "ID readable", ta: "அடையாளம் படிக்கக்கூடியது" },
  ai_photo_clear: { en: "Photo clear", ta: "புகைப்படம் தெளிவானது" },
  msg_signin_again: { en: "Please sign in again.", ta: "மீண்டும் உள்நுழையவும்." },
  msg_name_required: {
    en: "Please enter your name before saving.",
    ta: "சேமிப்பதற்கு முன் உங்கள் பெயரை உள்ளிடவும்.",
  },
  msg_saved: {
    en: "Saved. Your details are stored in your account.",
    ta: "சேமிக்கப்பட்டது. உங்கள் விவரங்கள் கணக்கில் பதிவாகிவிட்டன.",
  },
  msg_save_failed: { en: "Could not save your details", ta: "விவரங்களைச் சேமிக்க முடியவில்லை" },
  msg_consent_required: {
    en: "Please accept the Terms, Privacy Policy and No-Refund Policy.",
    ta: "விதிமுறைகள், தனியுரிமைக் கொள்கை மற்றும் பணம் திரும்பப் பெற முடியாத கொள்கையை ஏற்கவும்.",
  },
  msg_docs_required: {
    en: "A government ID and a clear profile photo are mandatory.",
    ta: "அரசு அடையாள அட்டை மற்றும் தெளிவான புகைப்படம் கட்டாயம்.",
  },
  msg_divorce_required: {
    en: "A court divorce certificate is mandatory for your marital status.",
    ta: "உங்கள் திருமண நிலைக்கு நீதிமன்ற விவாகரத்து சான்றிதழ் கட்டாயம்.",
  },
  msg_upload_both: {
    en: "Upload both the government ID and your photo first.",
    ta: "முதலில் அரசு அடையாள அட்டை மற்றும் உங்கள் புகைப்படத்தைப் பதிவேற்றவும்.",
  },
  msg_precheck_pass: {
    en: "Pre-check passed. You can submit for approval.",
    ta: "முன் சரிபார்ப்பு வெற்றி. ஒப்புதலுக்கு சமர்ப்பிக்கலாம்.",
  },
  msg_precheck_warn: {
    en: "Pre-check raised concerns — an admin will review manually.",
    ta: "முன் சரிபார்ப்பில் சந்தேகம் — நிர்வாகம் நேரடியாக ஆய்வு செய்யும்.",
  },
  msg_verify_failed: { en: "Verification failed", ta: "சரிபார்ப்பு தோல்வியடைந்தது" },
  msg_submitted: {
    en: "Submitted. Our team will review your profile.",
    ta: "சமர்ப்பிக்கப்பட்டது. எங்கள் குழு உங்கள் சுயவிவரத்தை ஆய்வு செய்யும்.",
  },
  msg_submit_failed: { en: "Could not submit", ta: "சமர்ப்பிக்க முடியவில்லை" },
  // jathagam admin page
  jat_page_title: { en: "Horoscope reports", ta: "ஜாதக அறிக்கைகள்" },
  jat_page_sub: {
    en: "Upload the verified horoscope PDF for a member, activate it for download and email them.",
    ta: "உறுப்பினருக்கான சரிபார்க்கப்பட்ட ஜாதக PDF-ஐப் பதிவேற்றி, பதிவிறக்கத்திற்கு செயல்படுத்தி, அவர்களுக்கு மின்னஞ்சல் அனுப்பவும்.",
  },
  jat_no_requests: { en: "No horoscope requests yet.", ta: "இதுவரை ஜாதக கோரிக்கைகள் இல்லை." },
  jat_member: { en: "Member", ta: "உறுப்பினர்" },
  jat_birth: { en: "Birth details", ta: "பிறப்பு விவரங்கள்" },
  jat_status_pending: { en: "Awaiting report", ta: "அறிக்கை எதிர்பார்க்கப்படுகிறது" },
  jat_status_uploaded: {
    en: "Uploaded, not activated",
    ta: "பதிவேற்றப்பட்டது, செயல்படுத்தப்படவில்லை",
  },
  jat_status_ready: { en: "Active for member", ta: "உறுப்பினருக்கு செயலில்" },
  jat_activate: { en: "Activate for member", ta: "உறுப்பினருக்கு செயல்படுத்து" },
  jat_email: { en: "Email report to member", ta: "உறுப்பினருக்கு மின்னஞ்சல் அனுப்பு" },
  jat_uploaded_ok: { en: "Report uploaded", ta: "அறிக்கை பதிவேற்றப்பட்டது" },
  jat_activated_ok: {
    en: "Report activated for the member",
    ta: "அறிக்கை உறுப்பினருக்கு செயல்படுத்தப்பட்டது",
  },
  jat_emailed_ok: {
    en: "Email sent to the member",
    ta: "உறுப்பினருக்கு மின்னஞ்சல் அனுப்பப்பட்டது",
  },
  jat_upload_first: { en: "Upload a report first.", ta: "முதலில் அறிக்கையைப் பதிவேற்றவும்." },
  jat_no_email: {
    en: "This member has no email on record.",
    ta: "இந்த உறுப்பினருக்கு மின்னஞ்சல் பதிவில் இல்லை.",
  },
  jat_failed: { en: "Action failed", ta: "செயல் தோல்வியடைந்தது" },
  // admin workspace
  adm_title: { en: "Admin Dashboard", ta: "நிர்வாகப் பலகை" },
  adm_nav_dashboard: { en: "Dashboard", ta: "முகப்பு" },
  adm_nav_members: { en: "Members", ta: "உறுப்பினர்கள்" },
  adm_nav_approvals: { en: "Pending approvals", ta: "ஒப்புதல் காத்திருப்பு" },
  adm_nav_payments: { en: "Payments", ta: "கட்டணங்கள்" },
  adm_nav_jathagam: { en: "Jathagam requests", ta: "ஜாதக கோரிக்கைகள்" },
  adm_nav_reports: { en: "Reports & blocks", ta: "புகார்கள் & தடைகள்" },
  adm_nav_alerts: { en: "Notifications", ta: "அறிவிப்புகள்" },
  adm_nav_settings: { en: "Admin settings", ta: "நிர்வாக அமைப்புகள்" },
  adm_total_members: { en: "Total members", ta: "மொத்த உறுப்பினர்கள்" },
  adm_verified_members: { en: "Approved members", ta: "ஒப்புதல் பெற்றவர்கள்" },
  adm_new_regs: { en: "New this week", ta: "இந்த வாரம் புதியவை" },
  adm_open_reports: { en: "Open reports", ta: "திறந்த புகார்கள்" },
  adm_pending_payments: { en: "Payments to verify", ta: "சரிபார்க்க வேண்டிய கட்டணங்கள்" },
  adm_jat_requests: { en: "Jathagam requests", ta: "ஜாதக கோரிக்கைகள்" },
  adm_active_alerts: { en: "Recent alerts", ta: "சமீபத்திய அறிவிப்புகள்" },
  adm_system_usage: { en: "System usage", ta: "அமைப்பு பயன்பாடு" },
  adm_empty_approvals: { en: "No pending approvals", ta: "ஒப்புதல் காத்திருப்பு எதுவும் இல்லை" },
  adm_empty_approvals_d: {
    en: "All submitted profiles have been reviewed.",
    ta: "சமர்ப்பிக்கப்பட்ட அனைத்து சுயவிவரங்களும் ஆய்வு செய்யப்பட்டுவிட்டன.",
  },
  adm_empty_jat: { en: "No Jathagam requests", ta: "ஜாதக கோரிக்கைகள் இல்லை" },
  adm_empty_jat_d: {
    en: "No horoscope requests are currently waiting.",
    ta: "தற்போது எந்த ஜாதக கோரிக்கையும் காத்திருக்கவில்லை.",
  },
  adm_empty_reports: { en: "No reports or blocks", ta: "புகார்கள் அல்லது தடைகள் இல்லை" },
  adm_empty_reports_d: {
    en: "No moderation actions require attention.",
    ta: "எந்த மேற்பார்வை நடவடிக்கையும் தேவையில்லை.",
  },
  adm_empty_payments: { en: "No payments yet", ta: "இதுவரை கட்டணங்கள் இல்லை" },
  adm_empty_payments_d: {
    en: "Payments appear here as members subscribe.",
    ta: "உறுப்பினர்கள் சந்தா செலுத்தும்போது இங்கே தோன்றும்.",
  },
  adm_empty_alerts: { en: "No notifications", ta: "அறிவிப்புகள் இல்லை" },
  adm_empty_alerts_d: {
    en: "Profile, approval and payment emails will be listed here.",
    ta: "சுயவிவரம், ஒப்புதல் மற்றும் கட்டண மின்னஞ்சல்கள் இங்கே பட்டியலிடப்படும்.",
  },
  adm_empty_members: { en: "No members match", ta: "பொருந்தும் உறுப்பினர்கள் இல்லை" },
  adm_empty_members_d: {
    en: "Adjust the search or filters above.",
    ta: "மேலே உள்ள தேடல் அல்லது வடிகட்டியை மாற்றவும்.",
  },
  adm_search: { en: "Search name, email or phone", ta: "பெயர், மின்னஞ்சல் அல்லது தொலைபேசி தேடுக" },
  adm_all: { en: "All", ta: "அனைத்தும்" },
  adm_view: { en: "View", ta: "பார்க்க" },
  adm_actions: { en: "Actions", ta: "செயல்கள்" },
  adm_name: { en: "Name", ta: "பெயர்" },
  adm_profile_id: { en: "Profile ID", ta: "சுயவிவர எண்" },
  adm_age: { en: "Age", ta: "வயது" },
  adm_location: { en: "Location", ta: "இடம்" },
  adm_reg_date: { en: "Registered", ta: "பதிவு தேதி" },
  adm_photo: { en: "Photo", ta: "புகைப்படம்" },
  adm_govt_id: { en: "Govt ID", ta: "அரசு அடையாளம்" },
  adm_payment: { en: "Payment", ta: "கட்டணம்" },
  adm_member: { en: "Member", ta: "உறுப்பினர்" },
  adm_plan: { en: "Plan", ta: "திட்டம்" },
  adm_amount: { en: "Amount", ta: "தொகை" },
  adm_method: { en: "Method", ta: "முறை" },
  adm_date: { en: "Date", ta: "தேதி" },
  adm_reporter: { en: "Reporter", ta: "புகார் அளித்தவர்" },
  adm_reason: { en: "Reason", ta: "காரணம்" },
  adm_close: { en: "Close", ta: "முடி" },
  adm_missing: { en: "Missing", ta: "இல்லை" },
  adm_uploaded: { en: "Uploaded", ta: "பதிவேற்றப்பட்டது" },
  adm_none: { en: "None", ta: "இல்லை" },
  // upload limits, gallery & documents
  msg_limit_photos: {
    en: "You can keep up to 6 photos. Delete one before adding another.",
    ta: "நீங்கள் அதிகபட்சம் 6 புகைப்படங்களை வைத்திருக்கலாம். மற்றொன்றைச் சேர்க்க முன் ஒன்றை நீக்கவும்.",
  },
  msg_limit_docs: {
    en: "You can keep up to 4 documents. Delete one before adding another.",
    ta: "நீங்கள் அதிகபட்சம் 4 ஆவணங்களை வைத்திருக்கலாம். மற்றொன்றைச் சேர்க்க முன் ஒன்றை நீக்கவும்.",
  },
  msg_limit_total_files: {
    en: "You can keep up to 10 files in total. Delete one before adding another.",
    ta: "மொத்தம் அதிகபட்சம் 10 கோப்புகளை மட்டுமே வைத்திருக்கலாம். மற்றொன்றைச் சேர்க்க முன் ஒன்றை நீக்கவும்.",
  },
  msg_limit_storage: {
    en: "You have used up the 20 MB storage allowance. Delete a file to free up space.",
    ta: "20 MB சேமிப்பு அனுமதி முடிந்துவிட்டது. இடத்தை காலி செய்ய ஒரு கோப்பை நீக்கவும்.",
  },
  msg_photo_too_large: {
    en: "This photo is larger than 3 MB. Please choose a smaller photo.",
    ta: "இந்த புகைப்படம் 3 MB ஐ விட பெரியது. சிறிய புகைப்படத்தை தேர்வு செய்யவும்.",
  },
  msg_doc_too_large: {
    en: "This document is larger than 5 MB. Please choose a smaller document.",
    ta: "இந்த ஆவணம் 5 MB ஐ விட பெரியது. சிறிய ஆவணத்தை தேர்வு செய்யவும்.",
  },
  upl_photo_hint: {
    en: "Upload a clear JPG or PNG photo. Large photos are automatically optimized while maintaining good visual quality.",
    ta: "தெளிவான JPG அல்லது PNG புகைப்படத்தை பதிவேற்றவும். பெரிய புகைப்படங்கள் நல்ல தரத்தில் தானாகவே உகந்ததாக்கப்படும்.",
  },
  upl_docs_hint: {
    en: "JPG, PNG or PDF. Documents stay exactly as uploaded and are visible to you and the admin only.",
    ta: "JPG, PNG அல்லது PDF. ஆவணங்கள் பதிவேற்றியதுபோலவே இருக்கும்; உங்களுக்கும் நிர்வாகிக்கும் மட்டுமே தெரியும்.",
  },
  upl_storage_hint: {
    en: "Profile storage: 20 MB. Photos are optimized; at most 6 photos, 4 documents and 10 files in total.",
    ta: "சுயவிவர சேமிப்பு: 20 MB. புகைப்படங்கள் உகந்ததாக்கப்படும்; அதிகபட்சம் 6 புகைப்படங்கள், 4 ஆவணங்கள், மொத்தம் 10 கோப்புகள்.",
  },
  upl_gallery_title: { en: "Photo Gallery", ta: "புகைப்பட கேலரி" },
  upl_gallery_sub: {
    en: "Add photos to your profile. The first photo is your main display photo.",
    ta: "உங்கள் சுயவிவரத்தில் புகைப்படங்களைச் சேர்க்கவும். முதல் புகைப்படம் உங்கள் முக்கிய புகைப்படம்.",
  },
  upl_primary: { en: "Main", ta: "முக்கியம்" },
  upl_add_photo: { en: "Add photo", ta: "புகைப்படம் சேர்" },
  uploading_label: { en: "Uploading…", ta: "பதிவேற்றுகிறது…" },
  upl_docs_title: { en: "Documents & Verification", ta: "ஆவணங்கள் மற்றும் சரிபார்ப்பு" },
  upl_no_docs: { en: "No documents uploaded yet.", ta: "இன்னும் ஆவணங்கள் பதிவேற்றப்படவில்லை." },
  docLabel: { en: "Document", ta: "ஆவணம்" },
  upl_uploaded_on: { en: "Uploaded", ta: "பதிவேற்றம்" },
  upl_storage_used_pre: { en: "Storage used", ta: "பயன்படுத்திய சேமிப்பு" },
  verified: { en: "Verified", ta: "சரிபார்க்கப்பட்டது" },
  unverified: { en: "Pending verification", ta: "சரிபார்ப்பு நிலுவையில்" },
  delete: { en: "Delete", ta: "நீக்கு" },
  delete_ok: { en: "File deleted", ta: "கோப்பு நீக்கப்பட்டது" },
  delete_doc_confirm: { en: "Delete this file?", ta: "இந்த கோப்பை நீக்கவா?" },
  remove_confirm_photo: {
    en: "Delete this photo? It will be removed from your profile.",
    ta: "இந்த புகைப்படத்தை நீக்கவா? இது உங்கள் சுயவிவரத்திலிருந்து அகற்றப்படும்.",
  },
  remove_confirm_doc: {
    en: "Delete this document? The stored file size will be freed.",
    ta: "இந்த ஆவணத்தை நீக்கவா? சேமிக்கப்பட்ட கோப்பு அளவு காலியாகும்.",
  },
  adm_confirm_approve: {
    en: "Approve this profile? The member will be notified by email.",
    ta: "இந்த சுயவிவரத்தை அங்கீகரிக்கவா? உறுப்பினருக்கு மின்னஞ்சல் அனுப்பப்படும்.",
  },
  adm_confirm_reject: {
    en: "Reject this profile? The member will be notified by email.",
    ta: "இந்த சுயவிவரத்தை நிராகரிக்கவா? உறுப்பினருக்கு மின்னஞ்சல் அனுப்பப்படும்.",
  },
  adm_settings_d: {
    en: "Admin account, contact details and system limits used by this dashboard.",
    ta: "இந்தப் பலகை பயன்படுத்தும் நிர்வாக கணக்கு, தொடர்பு விவரங்கள் மற்றும் வரம்புகள்.",
  },
  adm_loading: { en: "Loading…", ta: "ஏற்றுகிறது…" },
  adm_status: { en: "Status", ta: "நிலை" },
  adm_home_sub: {
    en: "Approvals, members, payments, horoscope reports and moderation in one place.",
    ta: "ஒப்புதல்கள், உறுப்பினர்கள், கட்டணங்கள், ஜாதக அறிக்கைகள் மற்றும் மேற்பார்வை ஒரே இடத்தில்.",
  },
  // Plan / item display names resolved from stable internal IDs
  plan_item_free: { en: "Community Starter", ta: "சமூக தொடக்கம்" },
  plan_item_standard: { en: "Standard", ta: "ஸ்டாண்டர்ட்" },
  plan_item_premium: { en: "Premium", ta: "பிரீமியம்" },
  plan_item_jathagam: { en: "Horoscope Report", ta: "ஜாதக அறிக்கை" },
  // Status labels
  st_pending: { en: "Pending", ta: "நிலுவையில்" },
  st_draft: { en: "Draft", ta: "வரைவு" },
  st_approved: { en: "Approved", ta: "ஒப்புதல் பெற்றது" },
  st_rejected: { en: "Rejected", ta: "நிராகரிக்கப்பட்டது" },
  st_submitted: { en: "Submitted", ta: "சமர்ப்பிக்கப்பட்டது" },
  st_verified: { en: "Verified", ta: "சரிபார்க்கப்பட்டது" },
  st_open: { en: "Open", ta: "திறந்துள்ளது" },
  st_closed: { en: "Closed", ta: "மூடப்பட்டது" },
  st_ready: { en: "Ready", ta: "தயார்" },
  st_uploaded: { en: "Uploaded", ta: "பதிவேற்றப்பட்டது" },
  st_suspended: { en: "Suspended", ta: "இடைநிறுத்தப்பட்டது" },
  method_online: { en: "Online", ta: "ஆன்லைன்" },
  method_manual: { en: "UPI / manual", ta: "UPI / நேரடி" },
  // auth + checkout validation / status messages
  msg_something_wrong: { en: "Something went wrong", ta: "ஏதோ தவறு ஏற்பட்டது" },
  auth_invalid: { en: "Please check your details", ta: "உங்கள் விவரங்களைச் சரிபார்க்கவும்" },
  auth_confirm_email: {
    en: "Please check your email to confirm your account.",
    ta: "கணக்கை உறுதிப்படுத்த உங்கள் மின்னஞ்சலைச் சரிபார்க்கவும்.",
  },
  checkout_birth_required: {
    en: "Enter the exact birth date, time and place first.",
    ta: "சரியான பிறந்த தேதி, நேரம் மற்றும் இடத்தை முதலில் உள்ளிடவும்.",
  },
  utr_required: { en: "Enter the UTR / reference number.", ta: "UTR / குறிப்பு எண்ணை உள்ளிடவும்." },
  payment_success: {
    en: "Payment successful. Your plan is active.",
    ta: "கட்டணம் வெற்றிகரமாக முடிந்தது. உங்கள் திட்டம் செயலில் உள்ளது.",
  },
  pay_window_load_fail: {
    en: "Could not load the payment window",
    ta: "கட்டண சாளரத்தை ஏற்ற முடியவில்லை",
  },
  confirm_payment_fail: {
    en: "Could not confirm payment",
    ta: "கட்டணத்தை உறுதிப்படுத்த முடியவில்லை",
  },
  pay_start_fail: { en: "Payment could not be started", ta: "கட்டணத்தைத் தொடங்க முடியவில்லை" },
  pay_unavailable: {
    en: "Online payment is not switched on yet. Please use the UPI / bank transfer option below.",
    ta: "ஆன்லைன் கட்டணம் இன்னும் இயக்கப்படவில்லை. கீழே உள்ள UPI / வங்கி பரிமாற்ற விருப்பத்தைப் பயன்படுத்தவும்.",
  },
  msg_open_report_fail: { en: "Could not open the report", ta: "அறிக்கையைத் திறக்க முடியவில்லை" },
  method_upi: { en: "UPI", ta: "UPI" },
  method_card: { en: "Card", ta: "கார்டு" },
  method_bank: { en: "Bank transfer", ta: "வங்கி பரிமாற்றம்" },
  profile_blocked: { en: "Profile blocked", ta: "சுயவிவரம் தடுக்கப்பட்டது" },
  report_prompt: {
    en: "Why are you reporting this profile?",
    ta: "இந்த சுயவிவரத்தை ஏன் புகார் செய்கிறீர்கள்?",
  },
  reported_ok: { en: "Reported to the admin", ta: "நிர்வாகத்திற்கு புகார் செய்யப்பட்டது" },
  yrs_unit: { en: "yrs", ta: "வயது" },
  last_updated: { en: "Last updated", ta: "கடைசியாக புதுப்பிக்கப்பட்டது" },
  // Profile origin
  adm_created_by: { en: "Created by", ta: "உருவாக்கியவர்" },
  adm_client_created: { en: "Client Created", ta: "வாடிக்கையாளர் உருவாக்கியது" },
  adm_admin_created: { en: "Admin Created", ta: "நிர்வாகி உருவாக்கியது" },
  adm_admin_created_long: {
    en: "Admin Created on behalf of Client",
    ta: "வாடிக்கையாளர் சார்பாக நிர்வாகி உருவாக்கியது",
  },
  adm_created_on: { en: "Created on", ta: "உருவாக்கிய தேதி" },
  adm_updated_by: { en: "Last updated by", ta: "கடைசியாக புதுப்பித்தவர்" },
  adm_last_updated: { en: "Last updated", ta: "கடைசி புதுப்பிப்பு" },
  adm_actor_admin: { en: "Admin", ta: "நிர்வாகி" },
  adm_actor_client: { en: "Client", ta: "வாடிக்கையாளர்" },
  adm_client_profiles: {
    en: "Client created profiles",
    ta: "வாடிக்கையாளர் உருவாக்கிய சுயவிவரங்கள்",
  },
  adm_admin_profiles: { en: "Admin created profiles", ta: "நிர்வாகி உருவாக்கிய சுயவிவரங்கள்" },
  adm_audit_history: { en: "Profile history", ta: "சுயவிவர வரலாறு" },
  adm_no_audit: { en: "No admin actions recorded.", ta: "நிர்வாக செயல்கள் எதுவும் பதிவாகவில்லை." },
  audit_admin_created: {
    en: "Admin created profile on behalf of client.",
    ta: "வாடிக்கையாளர் சார்பாக நிர்வாகி சுயவிவரத்தை உருவாக்கினார்.",
  },
  audit_admin_updated: {
    en: "Admin updated profile on behalf of client.",
    ta: "வாடிக்கையாளர் சார்பாக நிர்வாகி சுயவிவரத்தைப் புதுப்பித்தார்.",
  },
  audit_admin_updated_direct: {
    en: "Admin updated the profile directly.",
    ta: "நிர்வாகி சுயவிவரத்தை நேரடியாகப் புதுப்பித்தார்.",
  },
  audit_admin_updated_on_behalf: {
    en: "Admin updated the profile on behalf of the client after client confirmation/request.",
    ta: "வாடிக்கையாளர் உறுதிப்படுத்திய/கோரிய பிறகு, நிர்வாகி அவர்கள் சார்பாக சுயவிவரத்தைப் புதுப்பித்தார்.",
  },
  // Profile review + admin editing
  adm_review: { en: "Review", ta: "மதிப்பாய்வு" },
  adm_profile_review: { en: "Profile review", ta: "சுயவிவர மதிப்பாய்வு" },
  adm_documents: { en: "Photos & documents", ta: "புகைப்படங்கள் & ஆவணங்கள்" },
  adm_contact_info: { en: "Contact & location", ta: "தொடர்பு & இடம்" },
  adm_education: { en: "Education & occupation", ta: "கல்வி & பணி" },
  adm_family: { en: "Family information", ta: "குடும்ப விவரங்கள்" },
  adm_prefs: { en: "Partner preferences", ta: "துணை விருப்பங்கள்" },
  adm_basic: { en: "Personal / basic information", ta: "தனிப்பட்ட / அடிப்படை விவரங்கள்" },
  adm_close_btn: { en: "Close", ta: "மூடு" },
  adm_request_correction: { en: "Request correction", ta: "திருத்தம் கோரவும்" },
  adm_suspend: { en: "Suspend", ta: "இடைநிறுத்து" },
  adm_correction_prompt: {
    en: "What should the member correct?",
    ta: "உறுப்பினர் எதைத் திருத்த வேண்டும்?",
  },
  adm_correction_sent: { en: "Correction request sent", ta: "திருத்தக் கோரிக்கை அனுப்பப்பட்டது" },
  adm_confirm_suspend: {
    en: "Suspend this profile? The member will no longer appear in match search.",
    ta: "இந்தச் சுயவிவரத்தை இடைநிறுத்தவா? உறுப்பினர் பொருத்தத் தேடலில் தோன்ற மாட்டார்.",
  },
  adm_create_profile: {
    en: "Create Profile for Client",
    ta: "வாடிக்கையாளருக்காக சுயவிவரம் உருவாக்கவும்",
  },
  adm_create_profile_d: {
    en: "Enter the client's details. The profile belongs to the client and still needs the normal approval.",
    ta: "வாடிக்கையாளரின் விவரங்களை உள்ளிடவும். சுயவிவரம் வாடிக்கையாளருக்கே சொந்தம்; வழக்கமான ஒப்புதல் தேவை.",
  },
  adm_edit_profile: { en: "Edit on behalf of client", ta: "வாடிக்கையாளர் சார்பாக திருத்து" },
  adm_confirm_required: {
    en: "Client confirmation is required before updating this Client Created profile on their behalf.",
    ta: "வாடிக்கையாளர் உறுதிப்படுத்திய பிறகே, இந்த 'வாடிக்கையாளர் உருவாக்கிய' சுயவிவரத்தை அவர்கள் சார்பாகப் புதுப்பிக்க முடியும்.",
  },
  adm_client_request_title: {
    en: "Client request / confirmation",
    ta: "வாடிக்கையாளர் கோரிக்கை / உறுதிப்படுத்தல்",
  },
  adm_client_request_present: {
    en: "Client confirmation/request on record.",
    ta: "வாடிக்கையாளர் உறுதிப்படுத்தல் / கோரிக்கை பதிவில் உள்ளது.",
  },
  adm_client_request_missing_d: {
    en: "The client must confirm or request the change through client messages. Use “Request correction” or the Client messages area, then wait for the client's reply.",
    ta: "வாடிக்கையாளர், வாடிக்கையாளர் செய்திகள் மூலம் மாற்றத்தைக் கோர வேண்டும் அல்லது உறுதிப்படுத்த வேண்டும். 'திருத்தம் கோரவும்' அல்லது வாடிக்கையாளர் செய்திகள் பகுதியைப் பயன்படுத்தி, வாடிக்கையாளர் பதில் அளிக்கும் வரை காத்திருக்கவும்.",
  },
  adm_open_messages: {
    en: "Open client messages →",
    ta: "வாடிக்கையாளர் செய்திகளைத் திற →",
  },
  adm_no_client_request: {
    en: "No client request or confirmation on record yet.",
    ta: "இதுவரை வாடிக்கையாளர் கோரிக்கை அல்லது உறுதிப்படுத்தல்கள் பதிவில் இல்லை.",
  },
  adm_save: { en: "Save", ta: "சேமி" },
  adm_saved: { en: "Saved", ta: "சேமிக்கப்பட்டது" },
  adm_email_required: { en: "Client email is required", ta: "வாடிக்கையாளர் மின்னஞ்சல் தேவை" },
  adm_created_ok: {
    en: "Profile created for client",
    ta: "வாடிக்கையாளருக்கு சுயவிவரம் உருவாக்கப்பட்டது",
  },
  adm_exists_updated: {
    en: "This client already had a profile — it was updated instead.",
    ta: "இந்த வாடிக்கையாளருக்கு ஏற்கனவே சுயவிவரம் உள்ளது — அது புதுப்பிக்கப்பட்டது.",
  },
  adm_invite_sent: {
    en: "An account access link was emailed to the client.",
    ta: "கணக்கு அணுகல் இணைப்பு வாடிக்கையாளருக்கு மின்னஞ்சலில் அனுப்பப்பட்டது.",
  },
  adm_invite_failed: {
    en: "Client account is ready, but the access email could not be sent. Check the email settings.",
    ta: "வாடிக்கையாளர் கணக்கு தயாராக உள்ளது, ஆனால் அணுகல் மின்னஞ்சலை அனுப்ப முடியவில்லை. மின்னஞ்சல் அமைப்புகளைச் சரிபார்க்கவும்.",
  },
  adm_f_full_name: { en: "Full name", ta: "முழுப் பெயர்" },
  adm_f_email: { en: "Email", ta: "மின்னஞ்சல்" },
  adm_f_phone: { en: "Phone", ta: "தொலைபேசி" },
  adm_f_whatsapp: { en: "WhatsApp", ta: "வாட்ஸ்அப்" },
  adm_f_gender: { en: "Gender", ta: "பாலினம்" },
  adm_f_dob: { en: "Date of birth", ta: "பிறந்த தேதி" },
  adm_f_marital: { en: "Marital status", ta: "திருமண நிலை" },
  adm_f_subcaste: { en: "Sub-caste", ta: "உட்பிரிவு" },
  adm_f_city: { en: "City", ta: "நகரம்" },
  adm_f_district: { en: "Native district", ta: "சொந்த மாவட்டம்" },
  adm_f_education: { en: "Education level", ta: "கல்வி நிலை" },
  adm_f_profession: { en: "Profession", ta: "பணி" },
  adm_f_family: { en: "Family details", ta: "குடும்ப விவரம்" },
  adm_f_about: { en: "About", ta: "பற்றி" },
  adm_f_prefs: { en: "Partner preference notes", ta: "துணை விருப்பக் குறிப்புகள்" },
  pref_age_min_label: { en: "Preferred age (min)", ta: "விருப்ப வயது (குறைந்தபட்சம்)" },
  pref_age_max_label: { en: "Preferred age (max)", ta: "விருப்ப வயது (அதிகபட்சம்)" },
  adm_upload_docs: { en: "Photo & identity documents", ta: "புகைப்படம் & அடையாள ஆவணங்கள்" },
  adm_upload_failed: { en: "Upload failed", ta: "பதிவேற்றம் தோல்வியடைந்தது" },
  // Admin ↔ client support messages
  adm_nav_messages: { en: "Messages", ta: "செய்திகள்" },
  adm_nav_support: { en: "Support", ta: "உதவி" },
  adm_nav_communication: { en: "Communication", ta: "தொடர்பு" },
  adm_msg_sub: {
    en: "Support conversations between members and the office.",
    ta: "உறுப்பினர்களுக்கும் அலுவலகத்திற்கும் இடையிலான உதவி உரையாடல்கள்.",
  },
  adm_msg_empty: { en: "No client messages", ta: "வாடிக்கையாளர் செய்திகள் இல்லை" },
  adm_msg_empty_d: {
    en: "No support conversations require attention.",
    ta: "கவனம் தேவைப்படும் உதவி உரையாடல்கள் இல்லை.",
  },
  adm_msg_unread: { en: "Unread", ta: "படிக்கப்படாதது" },
  adm_msg_search: { en: "Search member or subject", ta: "உறுப்பினர் அல்லது தலைப்பைத் தேடுக" },
  adm_msg_select: { en: "Select a conversation", ta: "ஒரு உரையாடலைத் தேர்ந்தெடுக்கவும்" },
  adm_msg_reply: { en: "Type your reply", ta: "உங்கள் பதிலை உள்ளிடவும்" },
  adm_msg_send: { en: "Send", ta: "அனுப்பு" },
  adm_msg_last_update: { en: "Last updated", ta: "கடைசி புதுப்பிப்பு" },
  adm_msg_close: { en: "Close conversation", ta: "உரையாடலை மூடு" },
  adm_msg_reopen: { en: "Reopen", ta: "மீண்டும் திற" },
  adm_msg_admin: { en: "Office", ta: "அலுவலகம்" },
  // Member support area
  sup_title: { en: "Support", ta: "உதவி" },
  sup_sub: {
    en: "Ask the office about verification, payments, documents or profile changes.",
    ta: "சரிபார்ப்பு, கட்டணம், ஆவணங்கள் அல்லது சுயவிவர மாற்றங்கள் குறித்து அலுவலகத்திடம் கேளுங்கள்.",
  },
  sup_new: { en: "New support request", ta: "புதிய உதவி கோரிக்கை" },
  sup_subject: { en: "Subject", ta: "தலைப்பு" },
  sup_start: { en: "Start conversation", ta: "உரையாடலைத் தொடங்கு" },
  sup_none: { en: "No support conversations", ta: "உதவி உரையாடல்கள் இல்லை" },
  sup_none_d: {
    en: "Start a conversation and the office will reply here.",
    ta: "ஒரு உரையாடலைத் தொடங்குங்கள்; அலுவலகம் இங்கே பதிலளிக்கும்.",
  },
  sup_you: { en: "You", ta: "நீங்கள்" },
  msg_attach: { en: "Attach a file", ta: "கோப்பை இணைக்கவும்" },
  msg_attach_view: { en: "View", ta: "பார்க்க" },
  msg_attach_open: { en: "Open attachment", ta: "இணைப்பைத் திற" },
  msg_attach_open_failed: { en: "Could not open attachment", ta: "இணைப்பைத் திறக்க முடியவில்லை" },
  adm_storage_warn: {
    en: "Storage is at or above 90% capacity. Free up space or upgrade your plan now.",
    ta: "சேமிப்பு 90% அல்லது அதற்கு மேல் நிரம்பியுள்ளது. இடத்தை காலி செய்யவும் அல்லது திட்டத்தை உயர்த்தவும்.",
  },
  adm_r2_storage: { en: "Cloudflare R2 storage", ta: "Cloudflare R2 சேமிப்பு" },
  adm_db_usage: { en: "Database usage (approximate)", ta: "தரவுத்தள பயன்பாடு (தோராயமானது)" },
};

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: keyof typeof dict | string) => string };

const I18nContext = createContext<Ctx>({ lang: "en", setLang: () => {}, t: (k) => String(k) });

const LANG_STORAGE_KEY = "slmm-lang";

/** English twin page bases — these routes have a Tamil twin under /ta/ or /tn/. */
const ENGLISH_TWIN_BASES = [
  "/",
  "/terms",
  "/privacy",
  "/refund-policy",
  "/register",
  "/dashboard",
  "/jathagam",
  "/support",
  "/office-messages",
  "/communication",
];

/**
 * Resolves the language a twin URL requires, or null when the URL path does not
 * carry a language (keeps the persisted preference for those pages).
 */
export function langFromPathname(pathname: string): Lang | null {
  if (pathname === "/ta" || pathname.startsWith("/ta/")) return "ta";
  if (pathname === "/tn" || pathname.startsWith("/tn/")) return "ta";
  if (pathname === "/en" || pathname.startsWith("/en/")) return "en";
  if (ENGLISH_TWIN_BASES.includes(pathname)) return "en";
  return null;
}

function readStoredLang(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (stored === "ta" || stored === "en") return stored;
  } catch {
    /* ignore */
  }
  return "en";
}

function updateDocumentLang(l: Lang) {
  if (typeof document !== "undefined") document.documentElement.lang = l;
}

/**
 * Single shared language store. This is THE source of truth for the language
 * preference: every provider (root, TamilPage, EnglishPage) reads from it,
 * every toggle writes to it, and it is the only place that touches localStorage.
 * A forced twin page only overrides the *rendered* language for its own subtree
 * (the URL is the language there) — it never writes the preference by itself.
 *
 * The initial value prefers the URL on first load so a stale "ta" in storage
 * (written by old Tamil pages before this fix) can never make an English URL
 * flash/stay in Tamil.
 */
let currentLang: Lang =
  typeof window !== "undefined"
    ? langFromPathname(window.location.pathname) ?? readStoredLang()
    : "en";
const localeListeners = new Set<() => void>();

export function getLocale(): Lang {
  return currentLang;
}

export function subscribeLocale(fn: () => void): () => void {
  localeListeners.add(fn);
  return () => {
    localeListeners.delete(fn);
  };
}

export function setLocale(l: Lang) {
  if (currentLang === l) return;
  currentLang = l;
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, l);
  } catch {
    /* ignore */
  }
  updateDocumentLang(l);
  localeListeners.forEach((fn) => fn());
}

export function I18nProvider({ children, force }: { children: ReactNode; force?: Lang }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const storeLang = useSyncExternalStore(subscribeLocale, getLocale, getLocale);

  // Twin URLs carry their language; keep the shared preference in sync so a
  // reload, back/forward navigation or a non-twin page never shows stale text.
  useEffect(() => {
    const fromUrl = langFromPathname(pathname);
    if (fromUrl) setLocale(fromUrl);
  }, [pathname]);

  const lang = force ?? storeLang;

  const t = useCallback(
    (k: string) => {
      const entry = dict[k];
      if (!entry) return k;
      return entry[lang];
    },
    [lang],
  );

  const setLang = useCallback((l: Lang) => setLocale(l), []);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Wraps a Tamil twin page so everything inside renders in Tamil. */
export function EnglishPage({ children }: { children: ReactNode }) {
  return <I18nProvider force="en">{children}</I18nProvider>;
}

export function TamilPage({ children }: { children: ReactNode }) {
  return <I18nProvider force="ta">{children}</I18nProvider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
