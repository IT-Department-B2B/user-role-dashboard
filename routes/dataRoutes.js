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
  const hasDeals = ownDeals.length > 0;
  const hasOpps = ownOpps.length > 0;
  const hasTeam = teamMembers.length > 0;
  if (hasDeals && !hasOpps && hasTeam) return 'purchase_line_manager';
  if (hasOpps && !hasDeals && hasTeam) return 'sales_line_manager';
  if (hasOpps && !hasDeals && !hasTeam) return 'sales_executive';
  if (hasDeals && !hasOpps && !hasTeam) return 'purchase_executive';
  return hasTeam ? 'sales_line_manager' : 'sales_executive';
}

function formatDateTime(date) {
  return date.toISOString().split('.')[0] + 'Z';
}

function formatDateOnly(date) {
  return date.toISOString().split('T')[0];
}

function getDateRange(selectedRange) {
  const now = new Date();
  let fromDate = null;
  let toDate = new Date();

  switch (selectedRange) {
    case 'LAST_N_DAYS:7': fromDate = new Date(now); fromDate.setDate(now.getDate() - 7); break;
    case 'LAST_N_DAYS:30': fromDate = new Date(now); fromDate.setDate(now.getDate() - 30); break;
    case 'LAST_N_DAYS:90': fromDate = new Date(now); fromDate.setDate(now.getDate() - 90); break;
    case 'LAST_N_DAYS:180': fromDate = new Date(now); fromDate.setDate(now.getDate() - 180); break;
    case 'LAST_N_DAYS:365': fromDate = new Date(now); fromDate.setDate(now.getDate() - 365); break;
    case 'LAST_3_MONTHS': fromDate = new Date(now); fromDate.setMonth(now.getMonth() - 3); break;
    case 'LAST_6_MONTHS': fromDate = new Date(now); fromDate.setMonth(now.getMonth() - 6); break;
    case 'LAST_12_MONTHS': fromDate = new Date(now); fromDate.setFullYear(now.getFullYear() - 1); break;
    case 'THIS_MONTH': fromDate = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case 'LAST_MONTH': fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1); toDate = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case 'ALL_TIME':
    default: return [null, null];
  }

  return [fromDate, toDate];
}

router.get('/dashboard', isAuthenticated, async (req, res) => {
  try {
    const conn = await loginToSalesforce();
    const username = req.session.username;
    const selectedRange = req.query.range || 'LAST_N_DAYS:30';
    const isAdmin = username.toUpperCase() === 'ADMIN';
    const isMark = username.toUpperCase() === 'MARK';

    const [fromDate, toDate] = getDateRange(selectedRange);
    const fromDateStrDate = fromDate ? formatDateOnly(fromDate) : null;
    const toDateStrDate = toDate ? formatDateOnly(toDate) : null;
    const fromDateStrDateTime = fromDate ? formatDateTime(fromDate) : null;
    const toDateStrDateTime = toDate ? formatDateTime(toDate) : null;

    function buildDateFilter(field) {
      if (!fromDateStrDate || !toDateStrDate) return '';
      return ` AND ${field} >= ${fromDateStrDate} AND ${field} < ${toDateStrDate}`;
    }

    function buildDateTimeFilter(field) {
      if (!fromDateStrDateTime || !toDateStrDateTime) return '';
      return ` AND ${field} >= ${fromDateStrDateTime} AND ${field} < ${toDateStrDateTime}`;
    }

    console.log(`📅 Filter applied: ${selectedRange} | FROM: ${fromDateStrDate || 'ALL'} TO: ${toDateStrDate || 'ALL'}`);

    const [
      ownLeads,
      ownOppsCreated,
      ownOppsClosedWon,
      ownDealsCreated,
      ownDealsClosedWon
    ] = await Promise.all([
      conn.query(`SELECT Id FROM Lead WHERE Custom_Owner__c = '${username}'${buildDateTimeFilter('CreatedDate')}`),
      conn.query(`SELECT Id, AccountId, Amount FROM Opportunity WHERE Custom_Owner__c = '${username}' AND AccountId != null${buildDateTimeFilter('CreatedDate')}`),
      conn.query(`SELECT Id, Amount FROM Opportunity WHERE Custom_Owner__c = '${username}' AND StageName = 'Closed Won' AND AccountId != null${buildDateFilter('CloseDate')}`),
      conn.query(`SELECT Id, Account__c, Closed_Price__c FROM Deal__c WHERE Custom_Owner__c = '${username}'${buildDateTimeFilter('CreatedDate')}`),
      conn.query(`SELECT Id, Closed_Price__c FROM Deal__c WHERE Custom_Owner__c = '${username}' AND Deal_Status__c = 'Closed Won'${buildDateTimeFilter('Closed_By__c')}`)
    ]);

    // ✅ Unique Accounts: from Opportunity.AccountId + Deal__c.Account__c
    const oppAccountIds = ownOppsCreated.records.map(o => o.AccountId).filter(Boolean);
    const dealAccountIds = ownDealsCreated.records.map(d => d.Account__c).filter(Boolean);
    const allAccountIds = [...oppAccountIds, ...dealAccountIds];
    const uniqueAccounts = Array.from(new Set(allAccountIds));

    const netSales = ownOppsClosedWon.records.reduce((sum, o) => sum + (o.Amount || 0), 0);
    const netPurchase = ownDealsClosedWon.records.reduce((sum, d) => sum + (d.Closed_Price__c || 0), 0);

    const netData = { [username]: { netSales, netPurchase } };
    const teamPerformance = {};
    const teamMembers = teamConfig[username] || [];

    const roleKey = detectRole(username, ownDealsCreated.records, ownOppsCreated.records, teamMembers);
    const okr = JSON.parse(JSON.stringify(okrTargets[roleKey] || {}));
    const achievements = {};
    const isTeamLeader = roleKey.includes('line_manager') || roleKey === 'operations_head';
    const teamScope = isAdmin || isMark ? users.map(u => u.username.toUpperCase()).filter(u => u !== username.toUpperCase()) : teamMembers;

    for (let member of teamScope) {
      const [
        memberLeads,
        memberOppsCreated,
        memberOppsClosedWon,
        memberDealsCreated,
        memberDealsClosedWon
      ] = await Promise.all([
        conn.query(`SELECT Id FROM Lead WHERE Custom_Owner__c = '${member}'${buildDateTimeFilter('CreatedDate')}`),
        conn.query(`SELECT Id, AccountId, Amount FROM Opportunity WHERE Custom_Owner__c = '${member}' AND AccountId != null${buildDateTimeFilter('CreatedDate')}`),
        conn.query(`SELECT Id, Amount FROM Opportunity WHERE Custom_Owner__c = '${member}' AND StageName = 'Closed Won' AND AccountId != null${buildDateFilter('CloseDate')}`),
        conn.query(`SELECT Id, Account__c FROM Deal__c WHERE Custom_Owner__c = '${member}'${buildDateTimeFilter('CreatedDate')}`),
        conn.query(`SELECT Id, Closed_Price__c FROM Deal__c WHERE Custom_Owner__c = '${member}' AND Deal_Status__c = 'Closed Won'${buildDateTimeFilter('Closed_By__c')}`)
      ]);

      // ✅ Combine Opportunity.AccountId and Deal.Account__c
      const oppAccs = memberOppsCreated.records.map(o => o.AccountId).filter(Boolean);
      const dealAccs = memberDealsCreated.records.map(d => d.Account__c).filter(Boolean);
      const allAccs = [...oppAccs, ...dealAccs];
      const uniqueAccs = new Set(allAccs);

      teamPerformance[member] = {
        leads: memberLeads.totalSize,
        opportunities: memberOppsCreated.totalSize,
        deals: memberDealsCreated.totalSize,
        accounts: uniqueAccs.size
      };

      netData[member] = {
        netSales: memberOppsClosedWon.records.reduce((sum, o) => sum + (o.Amount || 0), 0),
        netPurchase: memberDealsClosedWon.records.reduce((sum, d) => sum + (d.Closed_Price__c || 0), 0)
      };
    }

    if (roleKey === 'sales_line_manager' && okr["Monthly Sales (Team Members)"]) {
      okr["Monthly Sales (Team Members)"].TARGET = teamMembers.length * 75000;
    }

    if (roleKey === 'purchase_line_manager' && okr["Monthly Purchase (Team Members)"]) {
      okr["Monthly Purchase (Team Members)"].TARGET = teamMembers.length * 100000;
    }

    if (roleKey === 'operations_head') {
      const totalNetSales = Object.values(netData).reduce((sum, d) => sum + (d.netSales || 0), 0);
      achievements["Monthly Sales (Self + Team Members)"] = totalNetSales;
    }

    if (roleKey.startsWith('sales')) {
      achievements["Monthly Sales (Self)"] = netData[username]?.netSales || 0;
      if (isTeamLeader && okr["Monthly Sales (Team Members)"]) {
        achievements["Monthly Sales (Team Members)"] = Object.entries(netData)
          .filter(([user]) => user !== username)
          .reduce((sum, [, d]) => sum + (d.netSales || 0), 0);
      }
      achievements["Monthly Opportunities Created"] = ownOppsCreated.records.length;
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
      achievements["Monthly Deals Created"] = ownDealsCreated.records.length;
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
      opportunities: ownOppsCreated.records,
      deals: ownDealsCreated.records,
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
