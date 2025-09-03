const axios = require("axios");

async function testBLS() {
  try {
    console.log("Testing BLS API...");
    const response = await axios.get("https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0");

    console.log("Status:", response.data.status);

    if (response.data.status === "REQUEST_SUCCEEDED") {
      const series = response.data.Results.series[0];
      const latestData = series.data.find((item) => item.latest === "true") || series.data[0];

      console.log("Latest CPI Data:");
      console.log("  Value:", latestData.value);
      console.log("  Period:", latestData.periodName, latestData.year);
      console.log("  Source: BLS");

      // Show first few data points
      console.log("\nRecent CPI History:");
      series.data.slice(0, 5).forEach((item) => {
        console.log(`  ${item.periodName} ${item.year}: ${item.value}`);
      });
    } else {
      console.log("Error:", response.data.message);
    }
  } catch (error) {
    console.error("Failed to fetch CPI data:", error.message);
  }
}

testBLS();
