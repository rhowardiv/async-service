/*jslint browser:true, plusplus:false, laxbreak:true, bitwise:false*/
/*global jQuery, window*/
/**
 * async-service
 *
 * Prereqs: jQuery1.3, async module
 * 
 * Create and manage XHR requests (in the form of Promises) so that they may be
 * tracked and optionally:
 * - serialized
 * - prioritized
 * - abandoned
 * 
 * Exports:
 * - unloadCheck() Since we're managing window.onbeforeunload here, this
 *   method is available for adding additional checks
 *
 * - Service() Get the main manager object; it has property "readOnly" (set
 * true to only allow read-only requests) and methods:
 * 
 *   Call(): Perform a request
 * 
 *   isClean(): Check if no non read-only requests are pending
 * 
 *   pipeLength(): Get the number of calls currently waiting in a pipe
 * 
 *   abandon(): Abandon one or more calls according to method+url
 */
(function (exports) //{{{
{
	var
	async = require('async'),
	my = exports,

	// a hash of unload check callbacks; see unloadCheck()
	unloadChecks = {};

	exports.Service = function ()
	{
		var
		pending  = [],
		pipes = {};

		function register(call)
		{
			var
			i,
			prioritize = call.prioritize || false,
			pipeName = call.pipeName || false,
			pipe;

			// find an empty slot in the "pending" array, or append
			for (i = 0; i <= pending.length; i++) {
				if (!(i in pending)) {
					pending[i] = call;
					break;
				}
			}

			call.unloadId = my.unloadCheck(null, function ()
			{
				return 'Pending: ' + call.method + ': ' + call.url;
			});

			if (pipeName) {
				if (!pipes[pipeName]) {
					pipes[pipeName] = [];
				}
				pipe = pipes[pipeName];

				if (prioritize && pipe.length > 0) {
					// put the call at the head of the pipe...
					pipe.unshift(call);
					// ... and swap it into 2nd place, allowing the current head to finish
					pipe[1] = [pipe[0], pipe[0] = pipe[1]][0];
				} else {
					pipe.push(call);
				}
				if (pipe.length > 1) {
					return 'delay';
				}
			}

			return 'proceed';
		}

		function deregister(call)
		{
			var
			i,
			pipeName = call.pipeName || false,
			pipe;

			my.unloadCheck(call.unloadId);

			if (pipeName) {
				pipe = pipes[pipeName];

				if (!pipe) {
					throw 'Unknown pipe "' + pipeName + '"';
				}

				pipe.shift();
				if (pipe.length) {
					// run the next call in the pipe
					pipe[0].makeRequest();
				}
			}

			i = jQuery.inArray(call, pending);
			if (i > -1) {
				delete pending[i];
			}
		}

		function isClean()
		{
			for (var i = 0; i < pending.length; i++) {
				if (i in pending && !pending[i].readOnly) {
					return false;
				}
			}
			return true;
		}

		function pipeLength(pipeName)
		{
			if (undefined === pipes[pipeName]) {
				throw "Unknown pipe \"" + pipeName + "\"";
			}
			return pipes[pipeName].length;
		}

		/**
		* @param args Object Required args:
		* - url
		*
		* Optional args:
		* - method: default is GET
		* - data: Data to send
		* - readOnly: Provide truthy to indicate this is a read-only action
		* - pipeName: Provide a string name to serialize the action in a pipe
		*   with that name;
		* - prioritize: Provide a truthy value to put this call ahead of any
		*   other waiting calls in the pipe.
		* - sync: Provide a truthy value to make this a blocking request (don't do this).
		*/
		function Call(args)
		{
			var
			abandoned = false,
			call = {
				url: args.url,
				method: args.method || 'GET',
				data: args.data || {},
				readOnly: args.readOnly || false,
				pipeName: args.pipeName || '',
				prioritize: args.prioritize || false,
				async: !(args.sync || false),

				abandon: function () {
					abandoned = true;
					deregister(call);
				},
			},
			promise = async.Promise().when(function () {
				deregister(call);
			}).fail(function () {
				deregister(call);
			});

			call.makeRequest = function ()
			{
				jQuery.ajax({
					'type': call.method,
					'async': !call.sync,
					'url': call.url,
					'data': call.data,
					'error': function (XHR, textStatus)
					{
						if (abandoned) {
							return;
						}
						promise.smash(textStatus + ': ' + XHR.responseText);
					},
					success: function (response)
					{
						if (abandoned) {
							return;
						}

						promise.fulfill(response);
					}
				});
			};

			if (!call.readOnly && this.readOnly) {
				promise.smash('All non read-only requests have been disabled!');
			} else if ('proceed' === pending.register(call)) {
				call.makeRequest();
			}

			return promise;
		}

		function abandon(method, url)
		{
			for (var i = 0; i < pending.length; i++) {
				if (i in pending && pending[i].method === method && pending[i].url === url) {
					pending[i].abandon();
				}
			}
		}

		return {
			'readOnly': false,
			'Call': Call,
			'isClean': isClean, 
			'pipeLength': pipeLength,
			'abandon': abandon,
		};
	};

	/**
	 * Since onbeforeunload should only be set in one place, expose it here
	 * in case there's anything else to be added.
	 *
	 * @param string name A unique key for the check. If a falsy value is
	 * provided, a UUID will be generated.
	 *
	 * @param Function check Omit to remove a previously set check. Otherwise,
	 * provide a function that returns a message to concatenate onto the
	 * onbeforeunload alert (empty string if you've nothing to add).
	 *
	 * @return String name
	 */
	exports.unloadCheck = function (name, check)
	{
		if (!name) {
			name = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
			.replace(
				/[xy]/g,
				function (c)
				{
					var
					r = Math.random() * 16 | 0,
					v = c === 'x' ? r : (r & 3 | 8);
					return v.toString(16);
				}
			);
		}

		if (arguments.length === 1) {
			delete unloadChecks[name];
			return;
		}

		unloadChecks[name] = check;

		return name;
	};

	window.onbeforeunload = function (e)
	{
		var
		check,
		message = '',
		i;

		for (i in unloadChecks) {
			if (unloadChecks.hasOwnProperty(i)) {
				check = unloadChecks[i]();
				if (check) {
					message += unloadChecks[i]() + "\n";
				}
			}
		}

		if (message === '') {
			return;
		}

		e = e || window.event;

		// For IE and Firefox
		if (e) {
			e.returnValue = message;
		}

		// For Safari
		return message;
	};

}(module.exports('async-service'))); // }}}


