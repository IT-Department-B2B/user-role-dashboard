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

function buildFilter(field, selectedRange) {
  if (selectedRange === 'ALL_TIME') return '';
  return `${field} >= ${selectedRange}`;
}

router.get('/dashboard', isAuthenticated, async (req, res) => {
  try {
    const conn = await loginToSalesforce();
    const username = req.session.username;
    const selectedRange = req.query.range || 'LAST_N_DAYS:30';
    const isAdmin = username.toUpperCase() === 'ADMIN';
    const isMark = username.toUpperCase() === 'MARK';

    const leadFilter = buildFilter('CreatedDate', selectedRange);
    const oppFilter = buildFilter('CloseDate', selectedRange);
    const dealFilter = buildFilter('Closed_By__c', selectedRange);

    const [ownLeads, ownOpps, ownDeals] = await Promise.all([
      conn.query(`SELECT Id FROM Lead ${leadFilter ? `WHERE ${leadFilter} AND Custom_Owner__c = '${username}'` : `WHERE Custom_Owner__c = '${username}'`}`),
      conn.query(`SELECT Id, AccountId, Amount, StageName FROM Opportunity ${oppFilter ? `WHERE ${oppFilter} AND StageName = 'Closed Won' AND Custom_Owner__c = '${username}'` : `WHERE StageName = 'Closed Won' AND Custom_Owner__c = '${username}'`}`),
      conn.query(`SELECT Id, Account__c, Closed_Price__c, Deal_Status__c FROM Deal__c ${dealFilter ? `WHERE ${dealFilter} AND Deal_Status__c = 'Closed Won' AND Custom_Owner__c = '${username}'` : `WHERE Deal_Status__c = 'Closed Won' AND Custom_Owner__c = '${username}'`}`)
    ]);

    const oppAccountIds = ownOpps.records.map(o => o.AccountId).filter(Boolean);
    const dealAccountIds = ownDeals.records.map(d => d.Account__c).filter(Boolean);
    const uniqueAccountIds = new Set([...oppAccountIds, ...dealAccountIds]);
    const uniqueAccounts = Array.from(uniqueAccountIds);

    const netSales = ownOpps.records.reduce((sum, o) => sum + (o.Amount || 0), 0);
    const netPurchase = ownDeals.records.reduce((sum, d) => sum + (d.Closed_Price__c || 0), 0);

    const netData = { [username]: { netSales, netPurchase } };
    const teamPerformance = {};
    const teamMembers = teamConfig[username] || [];

    const roleKey = detectRole(username, ownDeals.records, ownOpps.records, teamMembers);
    const okr = JSON.parse(JSON.stringify(okrTargets[roleKey] || {}));
    const achievements = {};
    const isTeamLeader = roleKey.includes('line_manager') || roleKey === 'operations_head';

    const teamScope = isAdmin || isMark
      ? users.map(u => u.username.toUpperCase()).filter(u => u !== username.toUpperCase())
      : teamMembers;

    for (let member of teamScope) {
      const [memberLeads, memberOpps, memberDeals] = await Promise.all([
        conn.query(`SELECT Id FROM Lead ${leadFilter ? `WHERE ${leadFilter} AND Custom_Owner__c = '${member}'` : `WHERE Custom_Owner__c = '${member}'`}`),
        conn.query(`SELECT Id, AccountId, Amount, StageName FROM Opportunity ${oppFilter ? `WHERE ${oppFilter} AND StageName = 'Closed Won' AND Custom_Owner__c = '${member}'` : `WHERE StageName = 'Closed Won' AND Custom_Owner__c = '${member}'`}`),
        conn.query(`SELECT Id, Account__c, Closed_Price__c, Deal_Status__c FROM Deal__c ${dealFilter ? `WHERE ${dealFilter} AND Deal_Status__c = 'Closed Won' AND Custom_Owner__c = '${member}'` : `WHERE Deal_Status__c = 'Closed Won' AND Custom_Owner__c = '${member}'`}`)
      ]);

      const oppAccs = memberOpps.records.map(o => o.AccountId).filter(Boolean);
      const dealAccs = memberDeals.records.map(d => d.Account__c).filter(Boolean);
      const uniqueAccs = new Set([...oppAccs, ...dealAccs]);

      teamPerformance[member] = {
        leads: memberLeads.totalSize,
        opportunities: memberOpps.totalSize,
        deals: memberDeals.totalSize,
        accounts: uniqueAccs.size
      };

      netData[member] = {
        netSales: memberOpps.records.reduce((sum, o) => sum + (o.Amount || 0), 0),
        netPurchase: memberDeals.records.reduce((sum, d) => sum + (d.Closed_Price__c || 0), 0)
      };
    }

    if (roleKey === 'sales_line_manager') {
      const teamCount = teamMembers.length;
      if (okr["Monthly Sales (Team Members)"]) okr["Monthly Sales (Team Members)"].TARGET = teamCount * 75000;
    }
    if (roleKey === 'purchase_line_manager') {
      const teamCount = teamMembers.length;
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
      achievements["Monthly Unique Accounts"] = uniqueAccounts.length;
    }

    if (roleKey.startsWith('sales')) {
      achievements["Monthly Sales (Self)"] = netData[username]?.netSales || 0;
      if (isTeamLeader && okr["Monthly Sales (Team Members)"]) {
        achievements["Monthly Sales (Team Members)"] = Object.entries(netData)
          .filter(([user]) => user !== username)
          .reduce((sum, [, d]) => sum + (d.netSales || 0), 0);
      }
      achievements["Monthly Opportunities Created"] = ownOpps.records.length;
      achievements["Monthly Leads Generated"] = ownLeads.records.length;
      achievements["Monthly Unique Accounts"] = uniqueAccounts.length;
    }

    if (roleKey.startsWith('purchase')) {
      achievements["Monthly Purchase (Self)"] = netData[username]?.netPurchase || 0;
      if (isTeamLeader && okr["Monthly Purchase (Team Members)"]) {
        achievements["Monthly Purchase (Team Members)"] = Object.entries(netData)
          .filter(([user]) => user !== username)
          .reduce((sum, [, d]) => sum + (d.netPurchase || 0), 0);
      }
      achievements["Monthly Deals Created"] = ownDeals.records.length;
      achievements["Monthly Leads Generated"] = ownLeads.records.length;
      achievements["Monthly Unique Accounts"] = uniqueAccounts.length;
    }

    const dojData = {};
    users.forEach(u => { dojData[u.username.toUpperCase()] = u.doj });

    res.render('dashboard_user', {
      username,
      selectedRange,
      isAdmin,
      leads: ownLeads.records,
      opportunities: ownOpps.records,
      deals: ownDeals.records,
      uniqueAccounts,
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

module.exports = router;
