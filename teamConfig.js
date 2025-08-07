const teamMapping = {
  'FAIZAL': ['AHMAD', 'MICHAEL', 'JOHN', 'RAY', 'ARCHIE', 'RICKY'],
  'VICTOR': ['MOHSIN', 'PETER'],
  'ROBIN': ['ADAM', 'SAM', 'MARCEL', 'FREDDIE'],
  'MARCUS': ['KEEV', 'RODY', 'ABRAHAM', 'RYAN', 'ATIN'],
  'DAISY': ['TIA', 'ZELLA'],
  'AVA': ['GLORIA', 'JENNIE', 'SONYA', 'LILY', 'LINZA'],
  'BRIAN': ['JASON_F', 'NEERAJ', 'ALLEN'],   // ✅ Fixed here
  'TONY': ['RICK', 'LEO', 'RICHARD'],
  'LUKE': ['OMAR', 'ALEX', 'JAMES'],
  'DAVID': ['DAVID']
};

// Add MARK with access to all users across all teams
teamMapping['MARK'] = Object.values(teamMapping).flat();

module.exports = teamMapping;
