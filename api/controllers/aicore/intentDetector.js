//Detect user intent based on simple regex rules. This is a very basic implementation and can be improved with more sophisticated NLP techniques.

const RULES = [
  {
    intent: "summarize",
    patterns: [
      /summari[sz]e/i,
      /\bsummary\b/i,
      /\btldr\b/i
    ]
  },
  {
    intent: "sql_report",
    patterns: [
      /\bsql\b/i,
      /generate.*report/i,
      /database.*report/i,
      /query.*table/i
    ]
  }
];

function detectIntent(text) {
  let winner = { intent: "unknown", score: 0 };

  for (const rule of RULES) {
    let score = 0;

    for (const pattern of rule.patterns) {
      if (pattern.test(text)) score += 10;
    }

    if (score > winner.score) {
      winner = {
        intent: rule.intent,
        score
      };
    }
  }

  return winner;
}


module.exports = detectIntent;