import type { Campus, PageType } from "@/lib/config";

export type SeedDocument = {
  sourceUrl: string;
  title: string;
  campus: Campus;
  pageType: PageType;
  contentType: "html" | "pdf";
  effectiveSession?: string;
  trustLevel: "official" | "official-portal";
  text: string;
  provenanceNote: string;
  extractionConfidence: number;
};

/**
 * Operator-assisted snapshot of publicly available, official Air University
 * pages. The production crawler is the primary ingestion path; in this
 * environment the official hosts answer automated requests with HTTP 403
 * (Cloudflare bot protection), so these official texts were retrieved with an
 * operator-assisted fetch and are stored with extractionMode =
 * "operator_snapshot". Nothing here is invented: every figure below appears in
 * the linked official page. Any page whose content could not be retrieved is
 * listed in SOURCE_GAPS rather than guessed.
 */
const SNAPSHOT_NOTE =
  "Operator-assisted retrieval of the official page. Live crawl from this environment received HTTP 403 from the host (bot protection). Re-verify with a live crawl before relying on time-sensitive figures.";

export const SEED_DOCUMENTS: SeedDocument[] = [
  {
    sourceUrl: "https://khi.au.edu.pk/Pages/Admission/fees_financial.aspx",
    title: "Air University Karachi Campus — Fee Structure Fall 2026",
    campus: "karachi",
    pageType: "fees",
    contentType: "html",
    effectiveSession: "Fall 2026",
    trustLevel: "official",
    extractionConfidence: 0.95,
    provenanceNote: SNAPSHOT_NOTE,
    text: `# AU Fee Structure for Fall-2026 Intake — Karachi Campus
The official Karachi Campus fee page publishes tuition fee per credit hour, first-semester credit hours and first-semester tuition fee for each program.

## Tuition fee by program (Fall 2026 intake)
| Program | Tuition fee per credit hour (Rs.) | 1st semester credit hours | 1st semester tuition fee (Rs.) |
| --- | --- | --- | --- |
| Bachelor of Business Administration | 7,650 | 17 | 130,050 |
| Bachelor of Science in Accounting & Finance | 6,850 | 17 | 116,450 |
| BS Business & Information Technology | 7,650 | 17 | 130,050 |
| BS Aviation Management | 7,650 | 18 | 137,700 |
| Bachelor of Science in Computer Science | 9,150 | 16 | 146,400 |
| Bachelor of Science in Cyber Security | 9,150 | 18 | 164,700 |
| BS Artificial Intelligence (BSAI) | 9,150 | 17 | 155,550 |
| BS Data Science | 9,150 | 17 | 155,550 |
| BS Software Engineering (Non-PEC) | 9,150 | 17 | 155,550 |
| BS Cyber Forensic & Security | 9,150 | 15 | 137,250 |
| BS Psychology | 5,900 | 18 | 106,200 |
| BS English | 5,900 | 18 | 106,200 |
| BS International Relations | 7,650 | 18 | 137,700 |
| BS Statistics and Data Analytical Science | 6,450 | 16 | 103,200 |

## One-time and per-semester charges
| Payable charge | Amount (Rs.) | Frequency / remarks |
| --- | --- | --- |
| Admission Application Processing Charges | 2,500 | Once, non-refundable, at the time of application submission |
| Admission Fee | 20,000 | Once, non-refundable, at the time of admission |
| Endowment Fund | 5,000 | Once at admission, refundable as per HEC Policy |
| Miscellaneous Charges | 6,000 | Per semester (refundable as per HEC policy) |
| Security Deposit | 10,000 | Once at admission, refundable after clearance |

BS Artificial Intelligence therefore costs Rs. 9,150 per credit hour and Rs. 155,550 tuition for the first semester (17 credit hours), before the one-time admission charges and per-semester miscellaneous charges.
These figures apply to the Karachi Campus Fall 2026 intake only. Other campuses publish their own fee tables and must not be mixed with these amounts.`,
  },
  {
    sourceUrl: "https://webdata.au.edu.pk/Pages/Admission/fees_financial.aspx",
    title: "Air University Islamabad — Fee Structure (official fee page snapshot)",
    campus: "islamabad-main",
    pageType: "fees",
    contentType: "html",
    trustLevel: "official",
    extractionConfidence: 0.9,
    provenanceNote: `${SNAPSHOT_NOTE} Campus scope: Islamabad main campus (webdata.au.edu.pk).`,
    text: `# Air University Fee Structure — Islamabad Main Campus
This fee table is published for the Islamabad main campus. It is campus-specific and must not be applied to Karachi.

## Tuition fee by program (Islamabad)
| Program | Tuition fee per credit hour (Rs.) | 1st semester credit hours | 1st semester tuition fee (Rs.) |
| --- | --- | --- | --- |
| Associate Degree Program (Computer Science) | 6,600 | 18 | 118,800 |
| BS Computer Science | 9,150 | 15 | 137,250 |
| BS Artificial Intelligence | 9,150 | 17 | 155,550 |
| BS Bio Informatics | 9,150 | 15 | 137,250 |
| BS Computer Games Development | 9,150 | 15 | 137,250 |
| BS Data Science | 9,150 | 15 | 137,250 |
| BS Information Technology | 9,150 | 15 | 137,250 |
| BS Software Engineering (Non-PEC) | 9,150 | 15 | 137,250 |
| BS Cyber Security | 9,150 | 18 | 164,700 |
| BS Cyber Forensic & Security | 9,150 | 15 | 137,250 |
| BS Cyber Psychology | 8,500 | 18 | 153,000 |
| BS Embedded System Security | 9,150 | 15 | 137,250 |
| BBA (Hons) | 7,650 | 16 | 122,400 |
| BS Accounting & Finance | 6,850 | 17 | 116,450 |
| BS Aviation Management | 7,650 | 18 | 137,700 |
| BS Tourism and Hospitality Management | 7,100 | 17 | 120,700 |
| BS Healthcare Management | 7,100 | 17 | 120,700 |
| BS Financial Technologies | 7,650 | 17 | 130,050 |
| BS Business Analytics | 7,650 | 17 | 130,050 |
| BS Business & Information Technology | 7,650 | 17 | 130,050 |
| BS English | 5,900 | 15 | 88,500 |
| BS Psychology | 5,900 | 18 | 106,200 |
| BS Communication & Media Studies | 6,500 | 18 | 117,000 |
| Bachelor in Education | 5,000 | 18 | 90,000 |
| BS Statistics and Data Analytical Science | 6,450 | 16 | 103,200 |
| BS Computational Mathematics with Data Analytics | 6,450 | 15 | 96,750 |
| BS Computational Physics | 6,000 | 18 | 108,000 |
| MS Mathematics | 9,000 | 13 | 117,000 |
| BS International Relations | 7,650 | 18 | 137,700 |
| BS Security Studies | 7,100 | 17 | 120,700 |
| Bachelor of Science in Strategic Studies | 6,000 | 18 | 108,000 |
| MS Strategic Studies | 7,000 | 12 | 84,000 |
| Bachelor of Laws | 10,000 | 18 | 180,000 |

## One-time charges (Islamabad)
| Payable charge | Amount (Rs.) | Remarks |
| --- | --- | --- |
| Admission Application Processing Charges | 2,500 | Non-refundable, once at the time of application |
| Admission Fee | 20,000 | Once at the time of admission |
| Endowment Fund | 5,000 | Once at admission, non-refundable |
| Security Deposit | 10,000 | Refundable after clearance |
| Miscellaneous charges | 6,000 | Per semester |

Note that some programs share the same per-credit-hour rate but differ in first-semester credit hours, so the first-semester total can differ between Islamabad and Karachi for the same program name.`,
  },
  {
    sourceUrl: "https://khi.au.edu.pk/Pages/Admission/FAQS.aspx",
    title: "Air University Karachi Campus — Frequently Asked Questions (Admissions)",
    campus: "karachi",
    pageType: "faq",
    contentType: "html",
    trustLevel: "official",
    extractionConfidence: 0.92,
    provenanceNote: SNAPSHOT_NOTE,
    text: `# Frequently Asked Questions (Admissions) — AU Karachi Campus
## Merit and entry test
Admission is granted on the basis of the candidate's performance in the AU-CBT (computer-based admission test) and previous academic qualifications, i.e. SSC and HSSC. Air University offers admission purely on merit. Candidates can appear in the entry test multiple times to improve their score; the merit for admission is prepared on the basis of the best score. Applicants can request recalculation of the aggregate merit score, although the aggregate merit score is calculated through an automated system.

## Academic thresholds quoted in the Karachi admissions FAQ
FA/FSc stream candidates should have passed the Part-I examination. Candidates who have completed HSSC should have a minimum of 60% marks for engineering programmes and 50% marks for all other non-engineering programmes. Candidates must be in possession of CNIC, Form 'B' or NICOP.

## Required documents while applying
Possession of a Computerized National Identity Card (CNIC) / Form 'B' or NICOP and a passport-size photograph with a clear background are mandatory. Online registration requires attachment of the HSSC marks sheet or A-Levels equivalence certificate; the same documents are required for verification during the selection and admission process. Postgraduate applicants are required to provide a valid GAT (General/Subject) result card. A-Level or other non-FSc candidates must obtain an IBCC equivalence certificate; attaching only O/A-Level grade reports is not sufficient.

## Application form and processing fee
AU does not require a manually printed and submitted admission form: the entire registration process for admission is online. The admission application processing fee is non-refundable in any case, including when a candidate does not appear in the test or does not join the university.

## Scholarship
Students who perform well academically and maintain a minimum GPA of 3.5 out of 4.0 in semester studies are eligible for a merit scholarship as per the AU merit scholarship policy in each semester.

## International students
International applicants can apply subject to fulfilment of the programme's basic eligibility criteria and holding a valid visa for Pakistan. After admission (if granted), an NOC from HEC and the Ministry of Interior of Pakistan is required. A candidate holding a Pakistani passport, or dual nationality where one nationality is Pakistani, is not treated as an international student.

## Address
Air University Karachi Campus, PAF Airmen Academy, Korangi Creek, Karachi, Pakistan.`,
  },
  {
    sourceUrl: "https://khi.au.edu.pk/Pages/Admission/how_to_apply.aspx",
    title: "Air University Karachi Campus — How to Apply (admissions section)",
    campus: "karachi",
    pageType: "how-to-apply",
    contentType: "html",
    trustLevel: "official",
    extractionConfidence: 0.75,
    provenanceNote:
      "Navigation and section structure of the official Karachi admissions page were retrievable; the step-by-step body text could not be fully retrieved from this environment. Content below is limited to what the page structure confirms plus the linked official admission portal entry point. No steps have been invented.",
    text: `# Admissions — How to Apply (AU Karachi Campus)
The official Karachi Campus admissions section provides the following published topics and links:
- Why Air University
- Admission Advertisement
- Fee and Financial Aid
- Admission Schedule
- Scholarship
- Eligibility Criteria
- Required Documents
- How to Apply
- Prepare for Admission Test
- Late Admission
- Frequently Asked Questions
- Transfer Students

Applications for Karachi Campus are submitted through the official online admission system at https://khiportals.au.edu.pk/admissions. The section is also reachable from the campus website at https://khi.au.edu.pk/Pages/Admission/how_to_apply.aspx.

The specific step-by-step instructions and the current admission schedule text on this page could not be verified during the last update. Users should open the official page or contact the admissions office before relying on any deadline.`,
  },
  {
    sourceUrl: "https://khiportals.au.edu.pk/admissions",
    title: "AU Karachi Online Admission Portal — Fall 2026 application requirements",
    campus: "karachi",
    pageType: "admissions",
    contentType: "html",
    effectiveSession: "Fall 2026",
    trustLevel: "official-portal",
    extractionConfidence: 0.9,
    provenanceNote: `${SNAPSHOT_NOTE} Official admission portal for the Karachi Campus.`,
    text: `# AU Admission Portal — Air University Karachi
The official online admission system for Air University Karachi displays "ADMISSIONS OPEN (Fall-2026)".

## Documents you need before starting the online application
- All academic certificates
- CNIC / B-Form and father's CNIC

The portal links to the following official resources:
- Admission Advertisement
- How to fill the online application form
- Important instructions
- Eligibility criteria
- Required documents for undergraduate students
- Required documents for graduate and postgraduate students (at the time of interview)
- Admission process for international students

Applications must be created and submitted online at https://khiportals.au.edu.pk/admissions. The portal does not require a manually printed form to be posted. A candidate account is created with basic details and a valid email address.

Fees are paid as per the official fee structure page for the Karachi Campus. The admission application processing fee of Rs. 2,500 is non-refundable.`,
  },
  {
    sourceUrl: "https://khi.au.edu.pk/Pages/About/Vision_Mission.aspx",
    title: "Air University Karachi Campus — About AU and initial program offerings",
    campus: "karachi",
    pageType: "programs",
    contentType: "html",
    trustLevel: "official",
    extractionConfidence: 0.92,
    provenanceNote: SNAPSHOT_NOTE,
    text: `# About Air University
Air University is a federally chartered public sector university, established in 2002. It offers more than 79 BS, MS and PhD programs across Engineering, Medicine, Computing & Artificial Intelligence, Business, Basic & Applied Sciences, Social Sciences, and Aerospace & Strategic Studies. All academic programs are approved by the Higher Education Commission (HEC), Pakistan Engineering Council (PEC) and the National Computing Education Accreditation Council.

## AU Karachi Campus
Air University launched its Karachi Campus from the Fall 2025 semester.

Initial program offerings across three faculties:
- Faculty of Computing & AI: BS Computer Science, BS Cyber Security, BS Data Science, BS Artificial Intelligence
- Air University School of Management (AUSOM): BBA, MBA, BS Accounting & Finance, BS Aviation Management
- Faculty of Social Sciences: BS English, BS Psychology

## Future academic expansion from Fall 2026 onwards
The Karachi Campus states that it will expand into Engineering and Basic & Applied Sciences. Planned programs listed are:
- BE Electrical Engineering (Electric Vehicles)
- BE Mechanical Engineering
- BE Computer Engineering
- BS Computational Mathematics with Data Analytics
- BS Computational Physics

These planned programs are published as future expansion, not necessarily as currently open admissions. Candidates should confirm the current offering status with the campus admissions office before applying.`,
  },
  {
    sourceUrl: "https://khi.au.edu.pk/",
    title: "Air University Karachi Campus — campus overview and contact details",
    campus: "karachi",
    pageType: "campus-info",
    contentType: "html",
    trustLevel: "official",
    extractionConfidence: 0.9,
    provenanceNote: SNAPSHOT_NOTE,
    text: `# AU Karachi Campus
Air University extends its legacy to Pakistan's financial and commercial hub with the establishment of its Karachi Campus in 2025. The campus offers programs aligned with national regulations and global standards and provides laboratories, modern classrooms and digital learning facilities. The page states that Air University is ranked No. 2 in Pakistan and among the 600–800 universities globally by Times Higher Education (THE).

## Contact information published on the campus home page
- Admissions: Fall 2026 admissions are referenced in the site navigation
- UAN: 051-111-AIR-UNI (051-111-247-864)
- Admission portal: https://khiportals.au.edu.pk/admissions
- Address: Air University Karachi Campus, PAF Airmen Academy, Korangi Creek, Karachi, Pakistan
- Campus website: https://khi.au.edu.pk/

The home page does not publish a Karachi-specific telephone extension, email address or deadline table in the text that could be verified. Those details, when needed, should be confirmed with the campus admissions office.`,
  },
  {
    sourceUrl: "https://www.au.edu.pk/pages/admission/Scholarship.aspx",
    title: "Air University — Need-based and merit scholarship policy",
    campus: "university-wide",
    pageType: "scholarship",
    contentType: "html",
    trustLevel: "official",
    extractionConfidence: 0.88,
    provenanceNote: `${SNAPSHOT_NOTE} University-wide policy page; campus-level application windows may differ.`,
    text: `# Need and merit based financial aid schemes
Every Fall semester Air University invites applications from fresh entrants for financial grants at the time of applying for admission through the AU portal. Based on the information provided by students, the Financial Aid Office prepares a list of needy/deserving students for financial grants. The scale of need-based grants depends on the availability of funds and is reviewed periodically. Students who miss the online application at the time of Fall admissions can apply to the Registrar for a financial grant on the prescribed form within fifteen days of commencement of the semester. Students admitted in the Spring semester are eligible to apply for a financial grant in the next fall semester on the prescribed form. Students admitted on open merit only are eligible for the need-based financial grant.

# Merit scholarships policy
Air University offers merit-based scholarships to outstanding students enrolled in undergraduate and graduate programs on the basis of semester results.

## Undergraduate merit scholarships
- Top three position holders of each program of a batch receive tuition fee waivers of Rs. 25,000 (1st), Rs. 20,000 (2nd) and Rs. 15,000 (3rd).
- Students attaining an SGPA of 4.0 receive Rs. 5,000 over and above, and are included among the first three position holders.
- The total value of the grant does not exceed 100 percent of paid tuition fee through AU or any other documented source.
- Students of all undergraduate programs are eligible. A minimum SGPA of 3.5 is required, with a full academic load in a regular semester.
- Merit scholarships are not awarded for the summer semester or to the final/graduating semester.
- Students with disciplinary punishment are disqualified for the next semester.
- A merit scholarship may be combined with a need-based scholarship or other fee rebate, but the cumulative award may not exceed 100 percent of paid tuition fee.

## Graduate merit scholarships
Students of all MBA/MS/MPhil programs are eligible with a minimum SGPA of 3.75, a full academic load in a regular semester, and no disciplinary punishment. Scholarships are not awarded for summer semester or thesis work duration.

## Advance merit scholarship
The scholarship policy also publishes an advance merit scholarship for new undergraduate entrants who secured 90 percent or above marks in Intermediate/equivalent, awarded as a 100 percent tuition fee waiver on successful completion of the first semester.

## Procedure
The Financial Aid Office processes merit scholarship cases within two months of the declaration of semester final results. In case of any conflict, the Vice Chancellor's decision is final.`,
  },
  {
    sourceUrl: "https://webdata.au.edu.pk/Pages/Admission/eligibility_criteria.aspx",
    title: "Air University — Eligibility Criteria (Islamabad main campus page)",
    campus: "islamabad-main",
    pageType: "eligibility",
    contentType: "html",
    trustLevel: "official",
    extractionConfidence: 0.9,
    provenanceNote: `${SNAPSHOT_NOTE} This eligibility page is published for the Islamabad main campus.`,
    text: `# Eligibility Criteria — Islamabad Main Campus
Higher Secondary School Certificate / A-Levels (involving a minimum of 12 years of schooling) or an IBCC equivalent qualification with at least 50% marks and having studied Mathematics is the basic eligibility requirement for admission to all BS Computing programs. Students who have not studied Mathematics at the intermediate level must pass a deficiency course in Mathematics (6 credit hours) in the first year, including zero semester.

## Program-level requirements listed on the page
- BS Computer Sciences (BSCS): HSSC/A-Levels or IBCC equivalent, minimum 50% marks, Mathematics required
- BS Data Science (BSDS): HSSC/A-Levels or IBCC equivalent, minimum 50% marks, Mathematics required
- BS Artificial Intelligence (BSAI): HSSC/A-Levels or IBCC equivalent, minimum 50% marks, Mathematics required
- BS Cyber Security (BSCYS): HSSC/A-Levels or IBCC equivalent, minimum 50% marks, Mathematics required
- BS Computer Games Development (BSCGD): HSSC/A-Levels or IBCC equivalent, minimum 50% marks, Mathematics required
- BS Embedded System Security (BSESS): HSSC/A-Levels or IBCC equivalent, minimum 50% marks, Mathematics required
- BS Bioinformatics (BSBI): HSSC/A-Levels or IBCC equivalent, minimum 50% marks, Mathematics required
- BS Cyber Psychology (BSCYPsy): HSSC/A-Levels or IBCC equivalent, minimum 50% marks, Mathematics required
- Bachelor of Science in Business and Information Technology (BSBIT): Higher Secondary School or equivalent with at least 50% marks in aggregate; AU Admission Test / NTS / HEC Test
- BS Tourism and Hospitality Management (BSTHM): Intermediate (Part I and II) of any Board of Intermediate and Secondary Education in Pakistan with 50% or more marks, or FSc/Pre-Medical/Pre-Engineering or equivalent (minimum 12 years) with at least 50% marks
- MS Business Analytics (Evening/Weekend): BS Business Administration/Management Sciences, BS Computer Science, BS Software Engineering or equivalent four-year degree (minimum 130 credit hours); 16 years of science (Statistics, Mathematics) and BS Engineering graduates are also eligible; bridging or zero semester may be added on a case-to-case basis

## Bachelor programs page notes
The published bachelor programs page states that applicants for BS Artificial Intelligence need either at least 50% marks in Intermediate (HSSC) with Mathematics (200 marks) or an IBCC-certified equivalent with Mathematics, OR at least 50% marks in Intermediate (HSSC) with Pre-Medical or an IBCC-certified equivalent. Percentages are absolute: 49.9% is not rounded up to 50%.

This document is campus-scoped to the Islamabad main campus. Karachi Campus publishes its own admissions section, and Karachi-specific eligibility must be confirmed from https://khi.au.edu.pk/Pages/Admission/eligibility_criteria.aspx.`,
  },
  {
    sourceUrl: "https://kc.au.edu.pk/Pages/Admission/fees_financial.aspx",
    title: "Air University Kharian Campus — Fee Structure Fall 2026",
    campus: "kharian",
    pageType: "fees",
    contentType: "html",
    effectiveSession: "Fall 2026",
    trustLevel: "official",
    extractionConfidence: 0.93,
    provenanceNote: `${SNAPSHOT_NOTE} Campus scope: Kharian Campus. Included to demonstrate campus-scoped fee separation; not valid for Karachi.`,
    text: `# AU Fee Structure for Fall-2026 Intake — Kharian Campus
| Program | Tuition fee per credit hour (Rs.) | 1st semester credit hours | 1st semester tuition fee (Rs.) |
| --- | --- | --- | --- |
| Bachelor of Business Administration | 7,650 | 17 | 130,050 |
| Bachelor of Science in Accounting & Finance | 6,850 | 17 | 116,450 |
| BS Business & Information Technology | 7,650 | 17 | 130,050 |
| BS Aviation Management | 7,650 | 18 | 137,700 |
| Bachelor of Science in Computer Science | 9,150 | 16 | 146,400 |
| Bachelor of Science in Cyber Security | 9,150 | 18 | 164,700 |
| BS Artificial Intelligence (BSAI) | 9,150 | 17 | 155,550 |
| BS Data Science | 9,150 | 17 | 155,550 |
| BS Software Engineering (Non-PEC) | 9,150 | 17 | 155,550 |
| BS Cyber Forensic & Security | 9,150 | 15 | 137,250 |
| BS Psychology | 5,900 | 18 | 106,200 |
| BS English | 5,900 | 18 | 106,200 |
| BS International Relations | 7,650 | 18 | 137,700 |
| BS Statistics and Data Analytical Science | 6,450 | 16 | 103,200 |

## One-time charges (Kharian)
| Payable charge | Amount (Rs.) | Remarks |
| --- | --- | --- |
| Admission Application Processing Charges | 2,500 | Non-refundable, once at the time of application submission |
| Admission Fee | 20,000 | Non-refundable, once at the time of admission |
| Endowment Fund | 5,000 | Refundable as per HEC Policy |
| Miscellaneous Charges | 6,000 | Per semester |
| Security Deposit | 10,000 | Refundable after clearance |

This Kharian Campus table has a similar shape to the Karachi table but is a separate official publication. It must not be quoted as a Karachi fee.`,
  },
  {
    sourceUrl: "https://www.au.edu.pk/",
    title: "Air University — institutional overview and campus network",
    campus: "university-wide",
    pageType: "about",
    contentType: "html",
    trustLevel: "official",
    extractionConfidence: 0.85,
    provenanceNote: `${SNAPSHOT_NOTE} Only institution-level facts were retained from this page.`,
    text: `# Air University
Air University is a federally chartered public sector university in Pakistan. The university website publishes its admissions sections (Why AU, admission advertisement, admission schedule, fee structure, program representatives, fee advance tax, transfer students, frequently asked questions, scholarships), its faculties (Computing & Cyber Security, Computing & Artificial Intelligence, Management, Social Sciences, Engineering, Health Sciences, Basic & Applied Sciences, Aerospace & Strategic Studies) and its campus network.

Campus network listed on the site:
- Islamabad Main Campus
- Aerospace & Aviation Campus (A&AC), Kamra
- Multan Campus
- Kharian Campus
- Karachi Campus (https://khi.au.edu.pk/)
- Bahu Campus, Shorkot Cantt

Constituent units include Fazaia Medical College Islamabad, Fazaia Ruth Pfau Medical College Karachi, College of Aviation Safety Management Karachi, College of Flying Training Risalpur, NASTP Institute of Information Technology Lahore and Fazaia College of Nursing and Allied Health Sciences.

Contact channels published by the university include the central UAN 051-111-AIR-UNI and the student/staff facilitation portals. Campus-specific fees, deadlines and eligibility must be read from the relevant campus publication, because the university does not publish one merged, campus-independent fee or deadline table.`,
  },
];

/**
 * Pages that were discovered but whose content could not be verified during
 * this ingestion cycle. They are surfaced publicly instead of being guessed.
 */
export const SOURCE_GAPS = [
  {
    url: "https://khi.au.edu.pk/Pages/Admission/admission_schedule.aspx",
    label: "Karachi Campus admission schedule",
    reason: "Official host returned HTTP 403 to automated retrieval; the schedule body could not be read.",
    status: "awaiting_verification",
    action: "Re-run the crawler from a permitted network or open the official page manually.",
  },
  {
    url: "https://khi.au.edu.pk/Pages/Admission/required_documents.aspx",
    label: "Karachi Campus required-documents page",
    reason: "Linked from the internal navigation, but full body text was not retrievable.",
    status: "awaiting_verification",
    action: "Queue for the next live crawl with followPdfs enabled.",
  },
  {
    url: "https://khi.au.edu.pk/Pages/Admission/eligibility_criteria.aspx",
    label: "Karachi Campus eligibility criteria",
    reason: "Linked from the internal navigation, but full body text was not retrievable. The Islamabad eligibility page is indexed separately and is not a substitute.",
    status: "awaiting_verification",
    action: "Verify during the next live crawl; do not infer Karachi criteria from another campus.",
  },
  {
    url: "https://khi.au.edu.pk/Pages/Admission/advertisement.aspx",
    label: "Current admission advertisement / closing dates",
    reason: "No verified official closing date was captured. Third-party admission portals publish conflicting dates, which are deliberately not treated as facts.",
    status: "conflicting_third_party_claims",
    action: "Treat as unverified until the official advertisement is ingested and dated.",
  },
  {
    url: "https://khi.au.edu.pk/Pages/Admission/FAQS.aspx#hostel",
    label: "Hostel and transport facilities at Karachi Campus",
    reason: "No official statement about hostel or transport provision was found on the retrieved official pages.",
    status: "not_documented",
    action: "Ask the campus administration; the assistant must not infer availability.",
  },
] as const;

export const SEED_SOURCES = [
  {
    name: "AU Karachi Campus (official)",
    baseUrl: "https://khi.au.edu.pk",
    campus: "karachi",
    scope: "official-subdomain",
    trustLevel: "official",
    notes: "Campus-specific admissions, fees, programs and campus information.",
  },
  {
    name: "AU Karachi Online Admission Portal",
    baseUrl: "https://khiportals.au.edu.pk",
    campus: "karachi",
    scope: "official-portal",
    trustLevel: "official-portal",
    notes: "Official application portal. Authenticated areas behind login are never crawled.",
  },
  {
    name: "AU main website",
    baseUrl: "https://www.au.edu.pk",
    campus: "university-wide",
    scope: "official",
    trustLevel: "official",
    notes: "Institution-wide policies such as the scholarship policy.",
  },
  {
    name: "AU webdata mirror",
    baseUrl: "https://webdata.au.edu.pk",
    campus: "islamabad-main",
    scope: "official",
    trustLevel: "official",
    notes: "Main-campus fee and eligibility publications.",
  },
  {
    name: "AU Central Admission Portal",
    baseUrl: "https://portals.au.edu.pk",
    campus: "university-wide",
    scope: "official-portal",
    trustLevel: "official-portal",
    notes: "Central online admission system.",
  },
  {
    name: "AU Kharian Campus",
    baseUrl: "https://kc.au.edu.pk",
    campus: "kharian",
    scope: "official-subdomain",
    trustLevel: "official",
    notes: "Included for campus separation testing; never answers Karachi questions.",
  },
] as const;
