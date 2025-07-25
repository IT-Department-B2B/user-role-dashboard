const teamMapping = {
  'FAIZAL': ['Ahmad', 'Michael', 'John', 'Ray', 'Archie', 'Ricky'],
  'VICTOR': ['Mohsin', 'Peter'],
  'ROBIN': ['Adam', 'Sam', 'Marcel', 'Fredie'],
  'MARCUS': ['Keev', 'Rody', 'Abraham', 'Ryan', 'Atin'],
  'DAISY': ['Tia', 'Zella'],
  'AVA': ['Gloria', 'Jennie', 'Sonya', 'Lily', 'Linza'],
  'BRIAN': ['Jason', 'Neeraj', 'Allen'],
  'TONY': ['Rick C', 'Leo M', 'Richard M'],
  'LUKE': ['Omar', 'Alex', 'James L']
};

// Add MARK with access to all users across all teams
teamMapping['MARK'] = Object.values(teamMapping).flat();

module.exports = teamMapping;
