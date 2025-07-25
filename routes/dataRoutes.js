const express = require('express');
const router = express.Router();
const loginToSalesforce = require('../salesforce');
const teamConfig = require('../teamConfig');
const okrTargets = require('../okrTargets');

function isAuthenticated(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  res.redirect('/login');
}

function detectRole(ownDeals, ownOpps, teamMembers) {
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

    const [ownLeads, ownAccounts, ownOpps, ownDeals] = await Promise.all([
      conn.query(`SELECT Id FROM Lead WHERE CreatedDate = ${selectedRange} AND Custom_Owner__c = '${username}'`),
      conn.query(`SELECT Id FROM Account WHERE CreatedDate = ${selectedRange} AND Custom_Owner__c = '${username}'`),
      conn.query(`SELECT Id, Amount, StageName FROM Opportunity WHERE CreatedDate = ${selectedRange} AND Custom_Owner__c = '${username}'`),
      conn.query(`SELECT Id, Closed_Price__c, Deal_Status__c FROM Deal__c WHERE CreatedDate = ${selectedRange} AND Custom_Owner__c = '${username}'`)
    ]);

    const netSales = ownOpps.records.filter(o => o.StageName === 'Closed Won' && o.Amount)
      .reduce((sum, o) => sum + o.Amount, 0);
    const netPurchase = ownDeals.records.filter(d => d.Deal_Status__c === 'Closed Won' && d.Closed_Price__c)
      .reduce((sum, d) => sum + d.Closed_Price__c, 0);

    const netData = {};
    netData[username] = { netSales, netPurchase };

    const teamPerformance = {};
    const teamMembers = teamConfig[username] || [];

    if (isAdmin) {
      const allRecords = await fetchAllRecords(conn, selectedRange);
      processPerformanceData(allRecords, teamPerformance, netData);
    } else {
      for (let member of teamMembers) {
        const [memberLeads, memberAccounts, memberOpps, memberDeals] = await Promise.all([
          conn.query(`SELECT Id FROM Lead WHERE CreatedDate = ${selectedRange} AND Custom_Owner__c = '${member}'`),
          conn.query(`SELECT Id FROM Account WHERE CreatedDate = ${selectedRange} AND Custom_Owner__c = '${member}'`),
          conn.query(`SELECT Id, Amount, StageName FROM Opportunity WHERE CreatedDate = ${selectedRange} AND Custom_Owner__c = '${member}'`),
          conn.query(`SELECT Id, Closed_Price__c, Deal_Status__c FROM Deal__c WHERE CreatedDate = ${selectedRange} AND Custom_Owner__c = '${member}'`)
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

    const roleKey = detectRole(ownDeals.records, ownOpps.records, teamMembers);
    const okr = JSON.parse(JSON.stringify(okrTargets[roleKey])); // safely cloned
    const achievements = {};
    const isTeamLeader = roleKey.includes('line_manager');

    if (roleKey === 'sales_line_manager' && okr["Monthly Sales (Team Members)"]) {
      okr["Monthly Sales (Team Members)"].TARGET = 100000 * teamMembers.length;
    }
    if (roleKey === 'purchase_line_manager' && okr["Monthly Purchase (Team Members)"]) {
      okr["Monthly Purchase (Team Members)"].TARGET = 100000 * teamMembers.length;
    }

    if (roleKey.startsWith('sales')) {
      achievements["Monthly Sales (Self)"] = netData[username]?.netSales || 0;
      if (isTeamLeader)
        achievements["Monthly Sales (Team Members)"] = Object.entries(netData)
          .filter(([user]) => user !== username)
          .reduce((sum, [, d]) => sum + (d.netSales || 0), 0);

      achievements["Monthly Opportunities Created"] = ownOpps.records.length;
      achievements["Monthly Leads Generated"] = ownLeads.records.length;
      achievements["Monthly Unique Accounts"] = ownAccounts.records.length;
    }

    if (roleKey.startsWith('purchase')) {
      achievements["Monthly Purchase (Self)"] = netData[username]?.netPurchase || 0;
      if (isTeamLeader)
        achievements["Monthly Purchase (Team Members)"] = Object.entries(netData)
          .filter(([user]) => user !== username)
          .reduce((sum, [, d]) => sum + (d.netPurchase || 0), 0);

      achievements["Monthly Deals Created"] = ownDeals.records.length;
      achievements["Monthly Leads Generated"] = ownLeads.records.length;
      achievements["Monthly Unique Accounts"] = ownAccounts.records.length;
    }

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
      roleKey
    });

  } catch (err) {
    console.error('❌ Dashboard Error:', err.message);
    res.status(500).send('Dashboard Error: ' + err.message);
  }
});

async function fetchAllRecords(conn, range) {
  const [leads, accounts, opps, deals, sales, purchases] = await Promise.all([
    conn.query(`SELECT Custom_Owner__c, COUNT(Id) total FROM Lead WHERE CreatedDate = ${range} GROUP BY Custom_Owner__c`),
    conn.query(`SELECT Custom_Owner__c, COUNT(Id) total FROM Account WHERE CreatedDate = ${range} GROUP BY Custom_Owner__c`),
    conn.query(`SELECT Custom_Owner__c, COUNT(Id) total FROM Opportunity WHERE CreatedDate = ${range} GROUP BY Custom_Owner__c`),
    conn.query(`SELECT Custom_Owner__c, COUNT(Id) total FROM Deal__c WHERE CreatedDate = ${range} GROUP BY Custom_Owner__c`),
    conn.query(`SELECT Custom_Owner__c, SUM(Amount) totalNetSales FROM Opportunity WHERE CreatedDate = ${range} AND StageName = 'Closed Won' GROUP BY Custom_Owner__c`),
    conn.query(`SELECT Custom_Owner__c, SUM(Closed_Price__c) totalNetPurchase FROM Deal__c WHERE CreatedDate = ${range} AND Deal_Status__c = 'Closed Won' GROUP BY Custom_Owner__c`)
  ]);
  return { leads, accounts, opps, deals, sales, purchases };
}

function processPerformanceData(data, perfObj, netObj) {
  const { leads, accounts, opps, deals, sales, purchases } = data;
  for (let row of leads.records) {
    const user = row.Custom_Owner__c;
    if (!perfObj[user]) perfObj[user] = {};
    perfObj[user].leads = row.total;
  }
  for (let row of accounts.records) {
    const user = row.Custom_Owner__c;
    if (!perfObj[user]) perfObj[user] = {};
    perfObj[user].accounts = row.total;
  }
  for (let row of opps.records) {
    const user = row.Custom_Owner__c;
    if (!perfObj[user]) perfObj[user] = {};
    perfObj[user].opportunities = row.total;
  }
  for (let row of deals.records) {
    const user = row.Custom_Owner__c;
    if (!perfObj[user]) perfObj[user] = {};
    perfObj[user].deals = row.total;
  }
  for (let row of sales.records) {
    const user = row.Custom_Owner__c;
    if (!netObj[user]) netObj[user] = {};
    netObj[user].netSales = row.totalNetSales || 0;
  }
  for (let row of purchases.records) {
    const user = row.Custom_Owner__c;
    if (!netObj[user]) netObj[user] = {};
    netObj[user].netPurchase = row.totalNetPurchase || 0;
  }
}

module.exports = router;
