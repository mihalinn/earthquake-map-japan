const fs = require('fs');
// TopoJSON library is usually not in node_modules here, 
// so let's try a simpler approach if possible.
// Actually, let's just parse the string and find the first "properties":{...}

try {
  const content = fs.readFileSync('c:\\Users\\kujia\\OneDrive\\デスクトップ\\地震マップ\\city.json', 'utf8');
  const match = content.match(/"properties":\{([^}]*)\}/);
  if (match) {
    console.log('--- Found Properties ---');
    console.log('{' + match[1] + '}');
  } else {
    console.log('No properties found via regex.');
    // Fallback: try to find the start of objects
    const objectsIndex = content.indexOf('"objects":{');
    if (objectsIndex !== -1) {
       console.log('Objects found at:', objectsIndex);
       console.log(content.substring(objectsIndex, objectsIndex + 500));
    }
  }
} catch (e) {
  console.error(e);
}
