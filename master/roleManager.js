// master/roleManager.js
// Single source of truth for all priority/role decisions.
// Change rules here; nothing else needs to change.

const VALID_ROLES = ['admin', 'teamlead', 'developer', 'employee', 'intern'];

const ROLE_LABELS = {
  admin:     'Admin',
  teamlead:  'Team Lead',
  developer: 'Developer',
  employee:  'Employee',
  intern:    'Intern',
};

// Maps a branch name to a branch type used in the priority matrix
function getBranchType(branch) {
  if (!branch) return 'other';
  const b = branch.toLowerCase();
  if (b === 'main' || b === 'master')                       return 'main';
  if (b === 'develop' || b === 'dev')                       return 'develop';
  if (b.startsWith('feature/'))                             return 'feature';
  if (b === 'testing' || b === 'test' || b.startsWith('test/')) return 'testing';
  if (b.startsWith('experimental/') || b.startsWith('exp/')) return 'experimental';
  if (b.startsWith('hotfix/'))                              return 'main';    // hotfixes = main urgency
  if (b.startsWith('release/'))                             return 'develop'; // releases = develop urgency
  return 'other';
}

//                  main  develop  feature  testing  experimental  other
const PRIORITY_MATRIX = {
  admin:     { main:1, develop:1, feature:2, testing:2, experimental:2, other:2 },
  teamlead:  { main:1, develop:2, feature:2, testing:3, experimental:3, other:3 },
  developer: { main:2, develop:2, feature:3, testing:3, experimental:4, other:4 },
  employee:  { main:3, develop:3, feature:4, testing:4, experimental:5, other:5 },
  intern:    { main:3, develop:4, feature:4, testing:5, experimental:5, other:5 },
};

const QUEUE_LABELS = {
  1: 'Q1 — Admin Queue (Production Critical)',
  2: 'Q2 — Team Lead Queue (Integration)',
  3: 'Q3 — Developer Queue (Feature Work)',
  4: 'Q4 — Employee Queue (Testing)',
  5: 'Q5 — Intern Queue (Experimental)',
};

const QUEUE_COLORS = {
  1: '#e74c3c',
  2: '#e67e22',
  3: '#3498db',
  4: '#2ecc71',
  5: '#95a5a6',
};

// Q5→Q4 after 120s, Q4→Q3 after 240s, Q3→Q2 after 420s, Q2→Q1 after 720s
const STARVATION_THRESHOLDS = {
  5: 120,
  4: 240,
  3: 420,
  2: 720,
  1: null,
};

function getQueueLevel(role, branch) {
  const normRole   = (role || '').toLowerCase().trim();
  const branchType = getBranchType(branch);
  const safeRole   = VALID_ROLES.includes(normRole) ? normRole : 'intern';
  return PRIORITY_MATRIX[safeRole][branchType];
}

// Encode convention: "admin-alice" → admin, "intern-bob" → intern
function extractRoleFromPusher(pusherName) {
  if (!pusherName) return 'intern';
  const n = pusherName.toLowerCase();
  if (n.startsWith('admin'))     return 'admin';
  if (n.startsWith('teamlead'))  return 'teamlead';
  if (n.startsWith('developer')) return 'developer';
  if (n.startsWith('employee'))  return 'employee';
  if (n.startsWith('intern'))    return 'intern';
  return 'intern';
}

function shouldPromote(currentQueueLevel, waitSeconds) {
  const threshold = STARVATION_THRESHOLDS[currentQueueLevel];
  if (threshold === null) return false;
  return waitSeconds >= threshold;
}

module.exports = {
  VALID_ROLES, ROLE_LABELS, QUEUE_LABELS, QUEUE_COLORS,
  STARVATION_THRESHOLDS, getBranchType, getQueueLevel,
  extractRoleFromPusher, shouldPromote,
};
