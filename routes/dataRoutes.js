const express = require('express');
const router = express.Router();
const loginToSalesforce = require('../salesforce');
const teamConfig = require('../teamConfig');
const okrTargets = require('../okrTargets');
const users = require('../users.json');

function isAuthenticated(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  res.redirect('/login');
}

function detectRole(username, ownDeals, ownOpps, teamMembers) {
  if (username.toUpperCase() === 'MARK') return 'operations_head';
  if (username.toUpperCase() === 'DAVID') return 'floor_manager';

  const hasDeals = ownDeals.length > 0;
  const hasOpps = ownOpps.length > 0;
  const hasTeam = teamMembers.length > 0;

  if (hasDeals && !hasOpps && hasTeam) return 'purchase_line_manager';
  if (hasOpps && !hasDeals && hasTeam) return 'sales_line_manager';
  if (hasOpps && !hasDeals && !hasTeam) return 'sales_executive';
  if (hasDeals && !hasOpps && !hasTeam) return 'purchase_executive';

  return hasTeam ? 'sales_line_manager' : 'sales_executive';
}

router.get('/dashboard', isAuthenticated, async (req, res) => {
  try {
    const conn = await loginToSalesforce();
    const username = req.session.username;
    const selectedRange = req.query.range || 'LAST_N_DAYS:30';
    const isAdmin = username.toUpperCase() === 'ADMIN';
    const isMark = username.toUpperCase() === 'MARK';

    // Date filters - remove when ALL_TIME
    const leadFilter = selectedRange === 'ALL_TIME' ? '' : `CreatedDate = ${selectedRange}`;
    const accountFilter = selectedRange === 'ALL_TIME' ? '' : `CreatedDate = ${selectedRange}`;
    const oppFilter = selectedRange === 'ALL_TIME' ? '' : `CloseDate = ${selectedRange}`;
    const dealFilter = selectedRange === 'ALL_TIME' ? '' : `Closed_By__c = ${selectedRange}`;

    // Fetch user's own records
    const [ownLeads, ownAccounts, ownOpps, ownDeals] = await Promise.all([
      conn.query(`SELECT Id FROM Lead ${leadFilter ? `WHERE ${leadFilter} AND Custom_Owner__c = '${username}'` : `WHERE Custom_Owner__c = '${username}'`}`),
      conn.query(`SELECT Id FROM Account ${accountFilter ? `WHERE ${accountFilter} AND Custom_Owner__c = '${username}'` : `WHERE Custom_Owner__c = '${username}'`}`),
      conn.query(`SELECT Id, Amount, StageName FROM Opportunity ${oppFilter ? `WHERE ${oppFilter} AND Custom_Owner__c = '${username}'` : `WHERE Custom_Owner__c = '${username}'`}`),
      conn.query(`SELECT Id, Closed_Price__c, Deal_Status__c FROM Deal__c ${dealFilter ? `WHERE ${dealFilter} AND Custom_Owner__c = '${username}'` : `WHERE Custom_Owner__c = '${username}'`}`)
    ]);

    // Calculate Net Sales & Net Purchase
    const netSales = ownOpps.records
      .filter(o => o.StageName === 'Closed Won' && o.Amount)
      .reduce((sum, o) => sum + o.Amount, 0);

    const netPurchase = ownDeals.records
      .filter(d => d.Deal_Status__c === 'Closed Won' && d.Closed_Price__c)
      .reduce((sum, d) => sum + d.Closed_Price__c, 0);

    const netData = {};
    netData[username] = { netSales, netPurchase };

    const teamPerformance = {};
    const teamMembers = teamConfig[username] || [];

    // Admin and Mark (get all users data)
    if (isAdmin || isMark) {
      const allRecords = await fetchAllRecords(conn, selectedRange);
      Object.keys(netData).forEach(key => delete netData[key]);
      Object.keys(teamPerformance).forEach(key => delete teamPerformance[key]);
      processPerformanceData(allRecords, teamPerformance, netData);
    } else {
      // Get team members data
      for (let member of teamMembers) {
        const [memberLeads, memberAccounts, memberOpps, memberDeals] = await Promise.all([
          conn.query(`SELECT Id FROM Lead ${leadFilter ? `WHERE ${leadFilter} AND Custom_Owner__c = '${member}'` : `WHERE Custom_Owner__c = '${member}'`}`),
          conn.query(`SELECT Id FROM Account ${accountFilter ? `WHERE ${accountFilter} AND Custom_Owner__c = '${member}'` : `WHERE Custom_Owner__c = '${member}'`}`),
          conn.query(`SELECT Id, Amount, StageName FROM Opportunity ${oppFilter ? `WHERE ${oppFilter} AND Custom_Owner__c = '${member}'` : `WHERE Custom_Owner__c = '${member}'`}`),
          conn.query(`SELECT Id, Closed_Price__c, Deal_Status__c FROM Deal__c ${dealFilter ? `WHERE ${dealFilter} AND Custom_Owner__c = '${member}'` : `WHERE Custom_Owner__c = '${member}'`}`)
        ]);

        teamPerformance[member] = {
          leads: memberLeads.totalSize,
          accounts: memberAccounts.totalSize,
          opportunities: memberOpps.totalSize,
          deals: memberDeals.totalSize
        };

        netData[member] = {
          netSales: memberOpps.records.filter(o => o.StageName === 'Closed Won' && o.Amount)
            .reduce((sum, o) => sum + o.Amount, 0),
          netPurchase: memberDeals.records.filter(d => d.Deal_Status__c === 'Closed Won' && d.Closed_Price__c)
            .reduce((sum, d) => sum + d.Closed_Price__c, 0)
        };
      }
    }

    // Detect role & set targets
    const roleKey = detectRole(username, ownDeals.records, ownOpps.records, teamMembers);
    const okr = JSON.parse(JSON.stringify(okrTargets[roleKey] || {}));
    const achievements = {};
    const isTeamLeader = roleKey.includes('line_manager') || roleKey === 'operations_head';

    if (isTeamLeader && (roleKey === 'sales_line_manager' || roleKey === 'purchase_line_manager')) {
      const teamCount = teamMembers.length;
      if (okr["Monthly Sales (Team Members)"]) okr["Monthly Sales (Team Members)"].TARGET = teamCount * 100000;
      if (okr["Monthly Purchase (Team Members)"]) okr["Monthly Purchase (Team Members)"].TARGET = teamCount * 100000;
    }

    if (roleKey === 'operations_head') {
      const totalNetSales = Object.values(netData).reduce((sum, d) => sum + (d.netSales || 0), 0);
      achievements["Monthly Sales (Self + Team Members)"] = totalNetSales;
    }

    if (roleKey === 'floor_manager') {
      if (okr["Monthly Sales (Self)"]) okr["Monthly Sales (Self)"].TARGET = 300000;
      achievements["Monthly Sales (Self)"] = netData[username]?.netSales || 0;
      achievements["Monthly Opportunities Created"] = ownOpps.records.length;
      achievements["Monthly Leads Generated"] = ownLeads.records.length;
      achievements["Monthly Unique Accounts"] = ownAccounts.records.length;
    }

    if (roleKey.startsWith('sales') && roleKey !== 'operations_head' && roleKey !== 'floor_manager') {
      achievements["Monthly Sales (Self)"] = netData[username]?.netSales || 0;
      if (isTeamLeader && okr["Monthly Sales (Team Members)"]) {
        achievements["Monthly Sales (Team Members)"] = Object.entries(netData)
          .filter(([user]) => user !== username)
          .reduce((sum, [, d]) => sum + (d.netSales || 0), 0);
      }
      achievements["Monthly Opportunities Created"] = ownOpps.records.length;
      achievements["Monthly Leads Generated"] = ownLeads.records.length;
      achievements["Monthly Unique Accounts"] = ownAccounts.records.length;
    }

    if (roleKey.startsWith('purchase') && roleKey !== 'operations_head') {
      achievements["Monthly Purchase (Self)"] = netData[username]?.netPurchase || 0;
      if (isTeamLeader && okr["Monthly Purchase (Team Members)"]) {
        achievements["Monthly Purchase (Team Members)"] = Object.entries(netData)
          .filter(([user]) => user !== username)
          .reduce((sum, [, d]) => sum + (d.netPurchase || 0), 0);
      }
      achievements["Monthly Deals Created"] = ownDeals.records.length;
      achievements["Monthly Leads Generated"] = ownLeads.records.length;
      achievements["Monthly Unique Accounts"] = ownAccounts.records.length;
    }

    // DOJ Map
    const dojData = {};
    users.forEach(u => {
      dojData[u.username.toUpperCase()] = u.doj;
    });

    // Render dashboard
    res.render('dashboard_user', {
      username,
      selectedRange,
      isAdmin,
      leads: ownLeads.records,
      accounts: ownAccounts.records,
      opportunities: ownOpps.records,
      deals: ownDeals.records,
      teamPerformance,
      netData,
      okr,
      achievements,
      roleKey,
      dojData
    });

  } catch (err) {
    console.error('❌ Dashboard Error:', err);
    res.status(500).send('Dashboard Error: ' + err.message);
  }
});

async function fetchAllRecords(conn, range) {
  const leadFilter = range === 'ALL_TIME' ? '' : `CreatedDate = ${range}`;
  const accountFilter = leadFilter;
  const oppFilter = range === 'ALL_TIME' ? '' : `CloseDate = ${range}`;
  const dealFilter = range === 'ALL_TIME' ? '' : `Closed_By__c = ${range}`;

  const [leads, accounts, opps, deals, sales, purchases] = await Promise.all([
    conn.query(`SELECT Custom_Owner__c, COUNT(Id) total FROM Lead ${leadFilter ? `WHERE ${leadFilter}` : ''} GROUP BY Custom_Owner__c`),
    conn.query(`SELECT Custom_Owner__c, COUNT(Id) total FROM Account ${accountFilter ? `WHERE ${accountFilter}` : ''} GROUP BY Custom_Owner__c`),
    conn.query(`SELECT Custom_Owner__c, COUNT(Id) total FROM Opportunity ${oppFilter ? `WHERE ${oppFilter}` : ''} GROUP BY Custom_Owner__c`),
    conn.query(`SELECT Custom_Owner__c, COUNT(Id) total FROM Deal__c ${dealFilter ? `WHERE ${dealFilter}` : ''} GROUP BY Custom_Owner__c`),
    conn.query(`SELECT Custom_Owner__c, SUM(Amount) totalNetSales FROM Opportunity ${oppFilter ? `WHERE ${oppFilter} AND StageName = 'Closed Won'` : `WHERE StageName = 'Closed Won'`} GROUP BY Custom_Owner__c`),
    conn.query(`SELECT Custom_Owner__c, SUM(Closed_Price__c) totalNetPurchase FROM Deal__c ${dealFilter ? `WHERE ${dealFilter} AND Deal_Status__c = 'Closed Won'` : `WHERE Deal_Status__c = 'Closed Won'`} GROUP BY Custom_Owner__c`)
  ]);

  return { leads, accounts, opps, deals, sales, purchases };
}

function processPerformanceData(data, perfObj, netObj) {
  const { leads, accounts, opps, deals, sales, purchases } = data;

  for (let row of leads.records) {
    if (!perfObj[row.Custom_Owner__c]) perfObj[row.Custom_Owner__c] = {};
    perfObj[row.Custom_Owner__c].leads = row.total;
  }
  for (let row of accounts.records) {
    if (!perfObj[row.Custom_Owner__c]) perfObj[row.Custom_Owner__c] = {};
    perfObj[row.Custom_Owner__c].accounts = row.total;
  }
  for (let row of opps.records) {
    if (!perfObj[row.Custom_Owner__c]) perfObj[row.Custom_Owner__c] = {};
    perfObj[row.Custom_Owner__c].opportunities = row.total;
  }
  for (let row of deals.records) {
    if (!perfObj[row.Custom_Owner__c]) perfObj[row.Custom_Owner__c] = {};
    perfObj[row.Custom_Owner__c].deals = row.total;
  }
  for (let row of sales.records) {
    if (!netObj[row.Custom_Owner__c]) netObj[row.Custom_Owner__c] = {};
    netObj[row.Custom_Owner__c].netSales = row.totalNetSales || 0;
  }
  for (let row of purchases.records) {
    if (!netObj[row.Custom_Owner__c]) netObj[row.Custom_Owner__c] = {};
    netObj[row.Custom_Owner__c].netPurchase = row.totalNetPurchase || 0;
  }
}

module.exports = router;
