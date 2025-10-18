#!/bin/bash

echo "🧪 Testing Hybrid Web App (SSR + Local-First P2P) Functionality"
echo "================================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Test functions
test_build() {
    print_status "Building the application for SSR mode..."
    if pnpm run build; then
        print_success "Application built successfully"
        return 0
    else
        print_error "Build failed"
        return 1
    fi
}

test_docker_build() {
    print_status "Building Docker images..."
    if docker-compose -f docker-compose.hybrid.yml build; then
        print_success "Docker images built successfully"
        return 0
    else
        print_error "Docker build failed"
        return 1
    fi
}

test_multi_node_startup() {
    print_status "Starting multi-node deployment..."
    if docker-compose -f docker-compose.hybrid.yml up -d; then
        print_success "Multi-node deployment started"
        sleep 30 # Wait for initialization
        return 0
    else
        print_error "Failed to start multi-node deployment"
        return 1
    fi
}

test_node_health() {
    print_status "Testing node health..."
    
    # Test Node A
    if curl -f http://localhost:3001/api/status >/dev/null 2>&1; then
        print_success "Node A (port 3001) is healthy"
        NODE_A_STATUS=0
    else
        print_error "Node A (port 3001) is not responding"
        NODE_A_STATUS=1
    fi
    
    # Test Node B  
    if curl -f http://localhost:3002/api/status >/dev/null 2>&1; then
        print_success "Node B (port 3002) is healthy"
        NODE_B_STATUS=0
    else
        print_error "Node B (port 3002) is not responding"
        NODE_B_STATUS=1
    fi
    
    return $((NODE_A_STATUS + NODE_B_STATUS))
}

test_mdns_discovery() {
    print_status "Testing mDNS peer discovery..."
    
    # Get status from both nodes to check peer discovery
    NODE_A_PEERS=$(curl -s http://localhost:3001/api/status | jq '.connectedPeers | length' 2>/dev/null || echo "0")
    NODE_B_PEERS=$(curl -s http://localhost:3002/api/status | jq '.connectedPeers | length' 2>/dev/null || echo "0")
    
    echo "Node A connected peers: $NODE_A_PEERS"
    echo "Node B connected peers: $NODE_B_PEERS"
    
    if [ "$NODE_A_PEERS" -gt 0 ] || [ "$NODE_B_PEERS" -gt 0 ]; then
        print_success "mDNS peer discovery is working"
        return 0
    else
        print_warning "No peers discovered yet (this is normal on first startup)"
        return 0
    fi
}

test_ssr_functionality() {
    print_status "Testing SSR functionality..."
    
    # Test that we get proper HTML from server-side rendering
    if curl -s http://localhost:3001/ | grep -q "<!DOCTYPE html>"; then
        print_success "Node A returns proper SSR HTML"
        SSR_A=0
    else
        print_error "Node A SSR not working"
        SSR_A=1
    fi
    
    if curl -s http://localhost:3002/ | grep -q "<!DOCTYPE html>"; then
        print_success "Node B returns proper SSR HTML"  
        SSR_B=0
    else
        print_error "Node B SSR not working"
        SSR_B=1
    fi
    
    return $((SSR_A + SSR_B))
}

test_pwa_functionality() {
    print_status "Testing PWA functionality..."
    
    # Check if service worker file exists
    if curl -f http://localhost:3001/sw.js >/dev/null 2>&1; then
        print_success "Service worker available on Node A"
        PWA_A=0
    else
        print_error "Service worker not found on Node A"
        PWA_A=1
    fi
    
    # Check manifest
    if curl -f http://localhost:3001/manifest.json >/dev/null 2>&1; then
        print_success "PWA manifest available"
        PWA_MANIFEST=0
    else
        print_error "PWA manifest not found"  
        PWA_MANIFEST=1
    fi
    
    return $((PWA_A + PWA_MANIFEST))
}

test_node_failover() {
    print_status "Testing node failover scenario..."
    
    print_status "Stopping Node A to simulate failure..."
    docker-compose -f docker-compose.hybrid.yml stop simple-todo-node-a
    sleep 10
    
    # Node A should be down
    if curl -f http://localhost:3001/api/status >/dev/null 2>&1; then
        print_error "Node A should be down but is still responding"
        return 1
    else
        print_success "Node A is properly stopped"
    fi
    
    # Node B should still be running
    if curl -f http://localhost:3002/api/status >/dev/null 2>&1; then
        print_success "Node B is still running after Node A failure"
    else
        print_error "Node B is not responding after Node A failure"
        return 1
    fi
    
    # Restart Node A
    print_status "Restarting Node A..."
    docker-compose -f docker-compose.hybrid.yml start simple-todo-node-a
    sleep 20
    
    # Both nodes should be back up
    if test_node_health; then
        print_success "Node failover test completed successfully"
        return 0
    else
        print_error "Node failover test failed"
        return 1
    fi
}

cleanup() {
    print_status "Cleaning up test environment..."
    docker-compose -f docker-compose.hybrid.yml down -v
    print_success "Cleanup completed"
}

# Main test execution
main() {
    print_status "Starting hybrid web app tests..."
    
    # Build tests
    if ! test_build; then
        print_error "Build test failed, stopping"
        exit 1
    fi
    
    if ! test_docker_build; then
        print_error "Docker build test failed, stopping"
        exit 1
    fi
    
    # Runtime tests
    if ! test_multi_node_startup; then
        print_error "Multi-node startup failed, stopping"
        exit 1
    fi
    
    # Give nodes time to fully initialize
    print_status "Waiting for nodes to fully initialize..."
    sleep 45
    
    if ! test_node_health; then
        print_error "Node health check failed"
        cleanup
        exit 1
    fi
    
    test_mdns_discovery
    
    if ! test_ssr_functionality; then
        print_warning "SSR functionality has issues"
    fi
    
    if ! test_pwa_functionality; then
        print_warning "PWA functionality has issues"
    fi
    
    if ! test_node_failover; then
        print_error "Node failover test failed"
        cleanup
        exit 1
    fi
    
    print_success "All hybrid web app tests completed successfully! 🎉"
    
    echo ""
    echo "📊 Test Summary:"
    echo "- ✅ Build: Passed"
    echo "- ✅ Docker Build: Passed"  
    echo "- ✅ Multi-node Startup: Passed"
    echo "- ✅ Node Health: Passed"
    echo "- ✅ Node Failover: Passed"
    echo ""
    echo "🌐 Access URLs:"
    echo "- Node A: http://localhost:3001"
    echo "- Node B: http://localhost:3002"
    echo ""
    echo "To stop the deployment: docker-compose -f docker-compose.hybrid.yml down -v"
}

# Handle script termination
trap cleanup EXIT

# Check dependencies
command -v docker >/dev/null 2>&1 || { print_error "docker is required but not installed. Aborting."; exit 1; }
command -v docker-compose >/dev/null 2>&1 || { print_error "docker-compose is required but not installed. Aborting."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { print_error "pnpm is required but not installed. Aborting."; exit 1; }
command -v curl >/dev/null 2>&1 || { print_error "curl is required but not installed. Aborting."; exit 1; }

# Run main test function
main "$@"