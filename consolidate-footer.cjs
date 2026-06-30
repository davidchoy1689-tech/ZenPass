#!/usr/bin/env node
/**
 * consolidate-footer.js
 * 
 * Scans all HTML files in the frontend directory and:
 * 1. Removes duplicated footer CSS blocks (<!-- Footer & Back-to-Top Styles --> ... </style>)
 * 2. Removes inline footer HTML (<footer class="footer-grad"> ... </footer>)
 * 3. Removes old back-to-top buttons (<button class="back-to-top" ... >↑</button> variants)
 * 4. Adds <script src="js/footer.js"></script> before </body>
 * 5. Also removes any leftover .footer-grad or back-to-top CSS scattered as inline <style> blocks
 */

const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, 'frontend');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html') && !f.startsWith('_'));

let changed = [];

files.forEach(file => {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;

  // --- 1. Remove Footer & Back-to-Top CSS block ---
  // Pattern: comment + <style>...</style> that contains footer-grad rules
  // We match the full block from the comment through the closing style tag
  content = content.replace(
    /[\t ]*<!-- Footer & Back-to-Top Styles -->\s*<style>[\s\S]*?\.footer-grad[\s\S]*?\.back-to-top[\s\S]*?<\/style>\n?/g,
    ''
  );

  // Also remove any standalone footer-grad CSS blocks (other pages may have slightly different comment)
  content = content.replace(
    /[\t ]*<!-- Footer[\s\S]*?Styles -->\s*<style>[\s\S]*?\.footer-grad[\s\S]*?<\/style>\n?/gi,
    ''
  );

  // --- 2. Remove inline footer HTML ---
  // Pattern: <footer class="footer-grad"> ... </footer> (may span many lines)
  content = content.replace(
    /<footer class="footer-grad">[\s\S]*?<\/footer>\n?/g,
    ''
  );

  // --- 3. Remove old back-to-top button (both single-line and multi-line formats) ---
  // Pattern: <button ... class="back-to-top" ... >   ↑   </button>
  content = content.replace(
    /<button[^>]*back-to-top[^>]*>[\s\S]*?<\/button>\n?/g,
    ''
  );

  // --- 4. Remove extra footer-link style blocks left from inline CSS ---
  // Some pages have leftover .footer-link .footer-grad rules in inline <style> blocks
  // Remove <style> blocks that ONLY contain footer-related selectors
  content = content.replace(
    /<style>\s*\.footer-link[\s\S]*?\.footer-link:hover[\s\S]*?<\/style>\n?/g,
    ''
  );

  // --- 5. Remove standalone .footer-grid, .footer-link fragments in style tags ---
  content = content.replace(
    /<style>\s*\.footer-grid[\s\S]*?<\/style>\n?/g,
    ''
  );

  // --- 6. Remove any lingering .footer-grad or back-to-top CSS in <style> blocks ---
  // This catches fragments like "html.dark .footer-grad { ... }" in inline style blocks
  content = content.replace(
    /<style>[\s\S]*?\.footer-grad[\s\S]*?<\/style>\n?/g,
    ''
  );
  content = content.replace(
    /<style>[\s\S]*?\.back-to-top[\s\S]*?<\/style>\n?/g,
    ''
  );

  // --- 7. Add footer.js script before </body> (if not already present) ---
  if (!content.includes('js/footer.js')) {
    content = content.replace(
      /<\/body>/i,
      '<script src="js/footer.js"></script>\n</body>'
    );
  } else {
    // Already has footer.js, ensure it's there exactly once
    // Remove any duplicate footer.js references
    content = content.replace(
      /(<script src="js\/footer\.js"><\/script>\s*)+/gi,
      '<script src="js/footer.js"></script>\n'
    );
  }

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    changed.push(file);
  }
});

console.log('✅ Updated ' + changed.length + ' files:');
changed.forEach(f => console.log('   - ' + f));
console.log('\nDone.');
