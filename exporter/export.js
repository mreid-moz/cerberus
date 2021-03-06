var Telemetry     = require('telemetry-js-node');
var _             = require('lodash');
var Promise       = require('promise');
var fs            = require('fs');
var mkdirp        = require('mkdirp');

// Create output directory
mkdirp.sync('histograms');

// Initialize telemetry
var telemetry_inited = new Promise(function(accept) {
  Telemetry.init(accept);
});

// Find versions to play with
var versions = null;
var telemetry_versions_filtered = telemetry_inited.then(function() {
  versions = Telemetry.versions();
  versions = versions.filter(function(v) {
    return /^nightly/.test(v);
  });

  versions.sort();
  versions = _.last(versions, 3);
});

// Load measures
var measures = null;
var measures_per_version = null;
var telemetry_measures_found = telemetry_versions_filtered.then(function() {
  return Promise.all(versions.map(function(version) {
    return new Promise(function(accept) {
      Telemetry.measures(version, accept);
    });
  })).then(function(values) {
    measures_per_version = values.map(function(measures) {
      return _.keys(measures);
    });
    measures = _.defaults.apply(_, values);
  });
});

function dumpHgramEvo(hgramEvo, path, result) {
  if (!hgramEvo.filterName()) {
    hgramEvo.each(function(date, hgram) {
      var output = {
        measure:      hgram.measure(),
        filter:       path,
        kind:         hgram.kind(),
        date:         date.toJSON(),
        submissions:  hgram.submissions(),
        count:        hgram.count(),
        buckets:      hgram.map(function(count, start) { return start }),
        values:       hgram.map(function(count) { return count })
      };

      if (hgram.kind() == 'linear' || hgram.kind() == 'exponential') {
        output.mean   = hgram.mean();
        output.median = hgram.median();
        output.p25    = hgram.percentile(25);
        output.p75    = hgram.percentile(75);
      }
      result.push(output);
    });
  }

  hgramEvo.filterOptions().forEach(function(option) {
    dumpHgramEvo(hgramEvo.filter(option), path.concat([option]), result);
  });
};

var measures_to_handle = null;
function handle_one() {
  var measure = measures_to_handle.pop();

  if (fs.existsSync('histograms/' + measure + '.json')) {
    console.log("Skipping: " + measure);
    handle_one();
    return;
  }

  console.log("Downloading: " + measure);
  var promises = [];

  versions.forEach(function(version, index) {
    if (measures_per_version[index].indexOf(measure) == -1) {
      return;
    }

    promises.push(new Promise(function(accept) {
      Telemetry.loadEvolutionOverBuilds(version, measure, accept);
    }));
  });

  return Promise.all(promises).then(function(evoHgrams) {
    var obj = [];

    evoHgrams.forEach(function(evoHgram) {
      if(evoHgram) {
        dumpHgramEvo(evoHgram, [], obj);
      }
    });

    // Write file async
    return new Promise(function(accept, reject) {
      fs.writeFile(
        'histograms/' + measure + '.json',
        JSON.stringify(obj, null, 2),
        function(err) {
          if (err) return reject(err);
          accept();
        }
      )
    }).then(function() {
      if(measures_to_handle.length > 0) {
        handle_one();
      }
    });
  }).catch(function(err) {console.log(err);});
};

// Load histograms
var load_histograms = telemetry_measures_found.then(function() {
  measures_to_handle = _.keys(measures).sort();
  // Download 3 in parallel
  handle_one();
  handle_one();
  handle_one();
}).catch(function(err) {console.log(err);});
