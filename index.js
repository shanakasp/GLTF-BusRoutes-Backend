const express = require("express");
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

// Data structures to store GTFS data with correct keys
const gtfsData = {
  routes: new Map(),
  stops: new Map(),
  trips: new Map(),
  stop_times: new Map(),
  calendar: new Map(),
};

// Required GTFS files mapping to their data keys
const fileMapping = {
  "routes.txt": "routes",
  "stops.txt": "stops",
  "trips.txt": "trips",
  "stop_times.txt": "stop_times",
  "calendar.txt": "calendar",
};

// Verify GTFS directory exists
function checkGTFSDirectory(gtfsPath) {
  if (!fs.existsSync(gtfsPath)) {
    console.error(`GTFS directory not found at: ${gtfsPath}`);
    console.log("Creating GTFS directory...");
    try {
      fs.mkdirSync(gtfsPath, { recursive: true });
      console.log("GTFS directory created successfully.");
    } catch (err) {
      throw new Error(`Failed to create GTFS directory: ${err.message}`);
    }
  }
}

// Create sample GTFS files if they don't exist
function createSampleGTFSFiles(gtfsPath) {
  const sampleData = {
    "routes.txt":
      "route_id,route_short_name,route_long_name,route_type\n1,101,Downtown Express,3",
    "stops.txt":
      "stop_id,stop_name,stop_lat,stop_lon\n1001,Downtown Station,40.712778,-74.006111",
    "trips.txt":
      "route_id,service_id,trip_id,trip_headsign\n1,1,1001,Downtown via Main St",
    "stop_times.txt":
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n1001,08:00:00,08:00:00,1001,1",
    "calendar.txt":
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n1,1,1,1,1,1,0,0,20240101,20241231",
  };

  Object.entries(sampleData).forEach(([filename, content]) => {
    const filePath = path.join(gtfsPath, filename);
    if (!fs.existsSync(filePath)) {
      try {
        fs.writeFileSync(filePath, content);
        console.log(`Created sample ${filename}`);
      } catch (err) {
        console.error(`Failed to create ${filename}: ${err.message}`);
      }
    }
  });
}

// Get primary key for each file type
function getPrimaryKey(fileName, row) {
  switch (fileName) {
    case "routes.txt":
      return row.route_id;
    case "stops.txt":
      return row.stop_id;
    case "trips.txt":
      return row.trip_id;
    case "stop_times.txt":
      return `${row.trip_id}_${row.stop_sequence}`;
    case "calendar.txt":
      return row.service_id;
    default:
      return null;
  }
}

// Enhanced loadGTFSData function with error handling
async function loadGTFSData(gtfsPath) {
  try {
    checkGTFSDirectory(gtfsPath);

    // Check if directory is empty
    if (fs.readdirSync(gtfsPath).length === 0) {
      console.log("GTFS directory is empty. Creating sample files...");
      createSampleGTFSFiles(gtfsPath);
    }

    for (const [fileName, dataKey] of Object.entries(fileMapping)) {
      const filePath = path.join(gtfsPath, fileName);

      if (!fs.existsSync(filePath)) {
        console.warn(`Missing file: ${fileName}`);
        continue;
      }

      try {
        const data = [];
        await new Promise((resolve, reject) => {
          fs.createReadStream(filePath)
            .on("error", (error) => {
              reject(new Error(`Error reading ${fileName}: ${error.message}`));
            })
            .pipe(csv())
            .on("data", (row) => {
              const primaryKey = getPrimaryKey(fileName, row);
              if (primaryKey) {
                gtfsData[dataKey].set(primaryKey, row);
              }
            })
            .on("end", () => {
              console.log(`Successfully loaded ${fileName}`);
              resolve();
            })
            .on("error", (error) => {
              reject(new Error(`Error parsing ${fileName}: ${error.message}`));
            });
        });
      } catch (error) {
        console.error(`Failed to load ${fileName}:`, error.message);
        throw error;
      }
    }
  } catch (error) {
    throw new Error(`GTFS data loading failed: ${error.message}`);
  }
}

// API Endpoints
app.get("/api/routes", (req, res) => {
  try {
    const routes = Array.from(gtfsData.routes.values());
    res.json(routes);
  } catch (error) {
    res.status(500).json({ error: "Failed to retrieve routes data" });
  }
});

app.get("/api/stops", (req, res) => {
  try {
    const stops = Array.from(gtfsData.stops.values());
    res.json(stops);
  } catch (error) {
    res.status(500).json({ error: "Failed to retrieve stops data" });
  }
});

// Get stops for a specific route
app.get("/api/routes/:routeId/stops", (req, res) => {
  try {
    const { routeId } = req.params;
    const routeTrips = Array.from(gtfsData.trips.values()).filter(
      (trip) => trip.route_id === routeId
    );

    const routeStops = new Set();
    routeTrips.forEach((trip) => {
      const tripStops = Array.from(gtfsData.stop_times.values())
        .filter((stopTime) => stopTime.trip_id === trip.trip_id)
        .map((stopTime) => gtfsData.stops.get(stopTime.stop_id));
      tripStops.forEach((stop) => {
        if (stop) routeStops.add(stop);
      });
    });

    res.json(Array.from(routeStops));
  } catch (error) {
    res.status(500).json({
      error: "Failed to retrieve route stops",
      message: error.message,
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Application error:", err.stack);
  res.status(500).json({
    error: "Internal Server Error",
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Something went wrong",
  });
});

// Initialize server
async function initializeServer() {
  const gtfsPath = path.join(__dirname, "gtfs_data");

  try {
    await loadGTFSData(gtfsPath);

    app.listen(port, () => {
      console.log(`GTFS API server running on port ${port}`);
      console.log(`GTFS data loaded from: ${gtfsPath}`);
    });
  } catch (error) {
    console.error("Server initialization failed:", error.message);
    console.log("\nTroubleshooting tips:");
    console.log("1. Check if gtfs_data directory exists in:", gtfsPath);
    console.log("2. Verify file permissions");
    console.log("3. Ensure GTFS files have correct column headers");
    console.log("4. Check if all required GTFS files are present");
    process.exit(1);
  }
}

initializeServer();
