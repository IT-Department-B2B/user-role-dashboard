// File: okrTargets.js

module.exports = {
  // ✅ New Role for Mark
  operations_head: {
    
   "Monthly Sales (Self + Team Members)": { WEIGHTAGE: 100, TARGET: 1500000 },
  },

  // ✅ New Role for David
  floor_manager: {
    "Monthly Sales (Self)": { WEIGHTAGE: 60, TARGET: 300000 }, // David's self target
    "Monthly Unique Accounts": { WEIGHTAGE: 10, TARGET: 50 },
    "Monthly Opportunities Created": { WEIGHTAGE: 10, TARGET: 100 },
    "Monthly Leads Generated": { WEIGHTAGE: 10, TARGET: 250 }
  },

  // Existing roles unchanged
  sales_line_manager: {
    "Monthly Sales (Self)": { WEIGHTAGE: 30, TARGET: 200000 },
    "Monthly Sales (Team Members)": { WEIGHTAGE: 30, TARGET: 700000 },
    "Monthly Unique Accounts": { WEIGHTAGE: 10, TARGET: 50 },
    "Monthly Opportunities Created": { WEIGHTAGE: 10, TARGET: 100 },
    "Monthly Leads Generated": { WEIGHTAGE: 10, TARGET: 250 }
  },

  purchase_line_manager: {
    "Monthly Purchase (Self)": { WEIGHTAGE: 30, TARGET: 200000 },
    "Monthly Purchase (Team Members)": { WEIGHTAGE: 30, TARGET: 700000 },
    "Monthly Unique Accounts": { WEIGHTAGE: 10, TARGET: 50 },
    "Monthly Deals Created": { WEIGHTAGE: 10, TARGET: 100 },
    "Monthly Leads Generated": { WEIGHTAGE: 10, TARGET: 250 }
  },

  sales_executive: {
    "Monthly Sales (Self)": { WEIGHTAGE: 60, TARGET: 100000 },
    "Monthly Unique Accounts": { WEIGHTAGE: 10, TARGET: 50 },
    "Monthly Opportunities Created": { WEIGHTAGE: 10, TARGET: 100 },
    "Monthly Leads Generated": { WEIGHTAGE: 10, TARGET: 250 }
  },

  purchase_executive: {
    "Monthly Purchase (Self)": { WEIGHTAGE: 60, TARGET: 100000 },
    "Monthly Unique Accounts": { WEIGHTAGE: 10, TARGET: 50 },
    "Monthly Deals Created": { WEIGHTAGE: 10, TARGET: 100 },
    "Monthly Leads Generated": { WEIGHTAGE: 10, TARGET: 250 }
  }
};
