<script>
    export let show = true
    export let title = "Simple-Todo-Example"
    export let description = "This is a web application that:"
    export let features = [
        "Does not store any cookies or perform any tracking",
        "Does not store any data in your browser's storage",
        "Stores data temporarily in your browser's memory only",
        "Does not use any application or database server for entered or personal data",
        "Connects to at least one relay server and other browser or mobile device directly for peer-to-peer communication",
        "The relay server may cache your entered data, making it visible to other users",
        "For decentralization purposes, this web app is hosted on the IPFS network"
    ]
    export let checkboxes = {
        relayConnection: {
            label: "I understand that this todo application is a demo app and will connect to a relay node",
            checked: false
        },
        dataVisibility: {
            label: "I understand that the relay may store the entered data, making it visible to other users",
            checked: false
        },
        globalDatabase: {
            label: "I understand that this todo application works with one global unencrypted database which is visible to others testing this app simultaneously",
            checked: false
        },
        replicationTesting: {
            label: "I understand that I need to open a second browser or mobile device with the same web address to test the replication functionality",
            checked: false
        }
    }
    export let proceedButtonText = "Continue"
    export let disabledButtonText = "Please check all boxes to continue"
    $: allCheckboxesChecked = Object.values(checkboxes).every(item => item.checked)
    // const allCheckboxesChecked = () => {
    //     return Object.values(checkboxes).every(item => item.checked)
    // }
    
    const handleProceed = () => {
        if (allCheckboxesChecked) {
            show = false
        }
    }
    
    const handleCheckboxChange = (key, checked) => {
        console.log('clicked', key, checked)
        if (checkboxes[key]) {
            checkboxes[key].checked = checked
            // Force reactivity by reassigning the entire object
            checkboxes = { ...checkboxes }
        }
    }
</script>

{#if show}
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div class="p-6">
                <h1 class="text-2xl font-bold mb-6 text-center text-gray-800">{title}</h1>
                
                <div class="space-y-4 mb-6">
                    <p class="text-gray-700">{description}</p>
                    <ul class="list-disc list-inside space-y-2 text-gray-700 ml-4">
                        {#each features as feature}
                            <li>{feature}</li>
                        {/each}
                    </ul>
                </div>
                
                <div class="space-y-4 mb-6">
                    <p class="text-gray-700 font-medium">Please confirm by checking the following boxes:</p>
                    
                    {#each Object.entries(checkboxes) as [key, item]}
                        <label class="flex items-start space-x-3 cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={item.checked}
                                on:click={(e) => {
                                    const target = e.target
                                    if (target && target instanceof HTMLInputElement) {
                                        handleCheckboxChange(key, target.checked)
                                    }
                                }}
                                class="mt-1 w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                            />
                            <span class="text-gray-700">{item.label}</span>
                        </label>
                    {/each}
                </div>
                
                <div class="flex justify-center">
                    <button 
                        on:click={handleProceed}
                        disabled={!allCheckboxesChecked}
                        class="px-6 py-3 bg-blue-500 text-white rounded-md font-medium transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-blue-600 disabled:hover:bg-gray-300"
                    >
                        {allCheckboxesChecked ? proceedButtonText : disabledButtonText}
                    </button>
                </div>
            </div>
        </div>
    </div>
{/if} 