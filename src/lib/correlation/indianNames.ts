/**
 * Top-100 Indian common first names and surnames list.
 * Used for common-name penalty evaluation in entity correlation (CONTEXT.md §7.3).
 */
export const TOP_100_INDIAN_NAMES = new Set<string>([
  // Common First Names
  "rahul",
  "amit",
  "rohit",
  "priya",
  "pooja",
  "neha",
  "anjali",
  "vikram",
  "abhishek",
  "aditya",
  "anand",
  "arjun",
  "deepak",
  "dinesh",
  "gaurav",
  "karan",
  "manish",
  "mayank",
  "mohit",
  "nithin",
  "nisha",
  "pankaj",
  "prateek",
  "rajesh",
  "ramesh",
  "sanjay",
  "saurabh",
  "shivam",
  "sneha",
  "sonam",
  "suresh",
  "varun",
  "vargas",
  "vijay",
  "vipin",
  "vishal",
  "vivek",
  "yash",
  "aakash",
  "aarti",
  "swati",
  "divya",
  "kavita",
  "megha",
  "payal",
  "rinku",
  "riya",
  "roshni",
  "shweta",
  "sunita",

  // Common Surnames / Family Names
  "kumar",
  "sharma",
  "singh",
  "verma",
  "gupta",
  "patel",
  "shah",
  "reddy",
  "rao",
  "joshi",
  "kulkarni",
  "nair",
  "pillai",
  "khan",
  "ali",
  "roy",
  "mehta",
  "agarwal",
  "mishra",
  "prasad",
  "chandra",
  "jain",
  "bhat",
  "bhatt",
  "sen",
  "ghosh",
  "dutta",
  "bose",
  "mukherjee",
  "banerjee",
  "chatterjee",
  "kapoor",
  "malhotra",
  "khanna",
  "saxena",
  "srivastava",
  "yadav",
  "chauhan",
  "rathore",
  "thakur",
  "deshmukh",
  "patil",
  "pawar",
  "shinde",
  "jadhav",
  "gaikwad",
  "hegde",
  "shetty",
  "gowda",
  "naidu",
  "choudhury",
  "biswas",
  "chakraborty",
  "dube",
  "dubey",
  "tripathi",
  "tiwari",
  "pandey",
  "dixit",
  "bhatnagar",
]);

/**
 * Checks if all significant (non-initial) tokens in a name belong to the common Indian names list.
 * If true, the name match is considered ultra-common and should be penalized in confidence scoring.
 *
 * @param tokens - Normalized name tokens
 * @returns boolean indicating if the tokens form a common Indian name combination
 */
export function isCommonIndianName(tokens: string[]): boolean {
  const nonInitialTokens = tokens.filter((t) => t.length > 1);
  if (nonInitialTokens.length === 0) return false;

  // If at least 2 non-initial tokens are present and ALL of them are in the top-100 list
  const commonCount = nonInitialTokens.filter((t) =>
    TOP_100_INDIAN_NAMES.has(t.toLowerCase()),
  ).length;

  if (nonInitialTokens.length >= 2) {
    return commonCount >= 2;
  }

  return commonCount === nonInitialTokens.length;
}
